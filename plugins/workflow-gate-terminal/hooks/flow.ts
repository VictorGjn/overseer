// @ts-nocheck
// Ported verbatim from workflow-gate 1.9.0 hooks/graph-editor.html (parse + control flow + splice),
// so the terminal shows the same flowchart the browser editor draws. Re-port when that file changes.
import * as acorn from './vendor/acorn.mjs'

// ---------------------------------------------------------------- parse
// Extract the declarative skeleton only: agent() calls, their mission/model/label/phase, and byte
// spans for the editable leaves. Imperative control flow is read for context but never rewritten.
function extract(src) {
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest', sourceType: 'module',
    allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowHashBang: true,
  });

  const nodes = [];
  const phases = [];
  const flags = { loop: false, budget: /\bbudget\s*\./.test(src), nested: false };
  const lit = (v) => (v?.type === 'Literal' ? v.value : null);
  const isCall = (n, re) => n?.type === 'CallExpression' && n.callee?.type === 'Identifier' && re.test(n.callee.name);

  // meta.phases — the declared execution order.
  walk(ast, (n) => {
    if (n.type !== 'Property' || n.key?.name !== 'phases' || n.value?.type !== 'ArrayExpression') return;
    for (const el of n.value.elements || []) {
      const t = el?.properties?.find((p) => p.key?.name === 'title');
      if (t?.value?.value) phases.push(t.value.value);
    }
  });

  // Module-scope `const X = [...]` — a fan-out over X is statically sized, and per-item labels can
  // be resolved when the label is `prefix:${d.slug}` and each element carries a literal `slug`.
  const arrays = {};
  for (const st of ast.body) {
    if (st.type !== 'VariableDeclaration' || st.kind !== 'const') continue;   // a `let` can be resized later
    for (const d of st.declarations) if (d.id?.type === 'Identifier' && d.init?.type === 'ArrayExpression') arrays[d.id.name] = d.init;
  }

  // Named functions passed as pipeline()/parallel() stages: agent() calls inside them run once per
  // item, but sit lexically OUTSIDE the call — v1 saw no fan-out at all there.
  const stageFns = {};   // fn name → { over, index, call }
  const fnBodies = {};   // fn name → function node
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) fnBodies[n.id.name] = n;
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && /Function/.test(n.init?.type || '')) fnBodies[n.id.name] = n.init;
    if (!isCall(n, /^pipeline$/)) return;
    n.arguments.slice(1).forEach((a, i) => { if (a.type === 'Identifier') stageFns[a.name] = { over: sourceOf(src, n.arguments[0]), index: i + 1, call: n }; });
  });

  // phase('X') calls, in statement order — the documented default grouping. Only opts.phase wins.
  const phaseCalls = [];
  walk(ast, (n) => { if (isCall(n, /^phase$/) && lit(n.arguments[0])) phaseCalls.push({ at: n.start, title: n.arguments[0].value }); });
  const phaseAt = (pos) => { let t = null; for (const p of phaseCalls) if (p.at < pos) t = p.title; return t; };

  // Every agent() / workflow() call site. `stack` = enclosing nodes, innermost first.
  const sites = [];
  walkWithStack(ast, (n, stack) => {
    const isAgent = isCall(n, /^agent$/), isWf = isCall(n, /^workflow$/);
    if (!isAgent && !isWf) return;
    const [promptArg, optsArg] = n.arguments;
    const opts = {};
    if (optsArg?.type === 'ObjectExpression') for (const p of optsArg.properties) if (p.key?.name) opts[p.key.name] = p.value;

    // Mission span: for a template literal we edit the LAST static chunk (the tail after any
    // ${interpolation}), so shared prefixes stay shared. For a plain string, the whole literal.
    let missionSpan = null, mission = '', missionKind = null, assembled = '';
    if (isAgent && promptArg?.type === 'TemplateLiteral') {
      const tail = promptArg.quasis[promptArg.quasis.length - 1];
      missionSpan = [tail.start, tail.end];
      // The text the agent receives (escapes decoded): an edit is escaped back when written.
      mission = tail.value.cooked ?? tail.value.raw;
      missionKind = promptArg.expressions.length ? 'template-tail' : 'template';
      // The whole prompt as the agent will receive it, each interpolation as a placeholder. An
      // emptiness check on the tail alone would block Approve on any prompt ending in ${...}.
      assembled = promptArg.quasis
        .map((qq, i) => (qq.value.cooked ?? qq.value.raw) + (promptArg.expressions[i] ? '⟨' + sourceOf(src, promptArg.expressions[i]) + '⟩' : ''))
        .join('');
    } else if (isAgent && promptArg?.type === 'Literal' && typeof promptArg.value === 'string') {
      missionSpan = [promptArg.start + 1, promptArg.end - 1];
      mission = promptArg.value;
      missionKind = 'string';
      assembled = promptArg.value;
    } else if (promptArg) {
      assembled = '⟨' + sourceOf(src, promptArg) + '⟩';   // computed prompt: shown, never editable
    }

    // Fan-out: an enclosing parallel()/pipeline() sized by its first argument. ONE template node
    // with a multiplicity, never N nodes. A module-scope literal array gives a real count.
    let fanOut = null, stage = null;
    for (const anc of stack) {
      if (!isCall(anc, /^(parallel|pipeline)$/)) continue;
      const first = anc.arguments[0];
      if (anc.callee.name === 'pipeline') {
        const idx = anc.arguments.slice(1).findIndex((a) => stack.includes(a));
        if (idx >= 0) stage = { call: anc, index: idx + 1 };
      }
      const fo = sizeFanOut(src, first, arrays, stack);
      if (!fo) continue;                 // parallel([thunk, thunk]) — each thunk is its own site
      fanOut = fanOut || fo;
      if (fanOut.n === null) break;
    }
    // …or the call lives in a named function that pipeline() runs per item.
    if (!fanOut) for (const anc of stack) {
      const name = anc.type === 'FunctionDeclaration' ? anc.id?.name : null;
      const asVar = stack.find((s) => s.type === 'VariableDeclarator' && s.init === anc)?.id?.name;
      const hit = stageFns[name] || stageFns[asVar];
      if (hit) { fanOut = { n: null, over: hit.over, labels: null }; stage = { call: hit.call, index: hit.index }; break; }
    }

    // `agent(d.prompt)` inside a fan-out over a literal array: the prompt is not editable (it is
    // per item) but it IS knowable — resolve every item's prompt so the face and panel show text
    // instead of "⟨d.prompt⟩" for the one node that launches most of the agents.
    if (fanOut?.items && promptArg?.type === 'MemberExpression' && promptArg.object?.name === fanOut.param && promptArg.property?.name) {
      const prop = promptArg.property.name;
      const per = fanOut.items.map((el) => { const p = el?.type === 'ObjectExpression' ? el.properties.find((q) => q.key?.name === prop) : null; return p ? assembleOf(src, p.value) : null; });
      if (per.every((x) => x !== null)) { fanOut.prompts = per; assembled = per[0]; }
    }
    if (fanOut) delete fanOut.items;

    // Guard: the innermost condition or loop enclosing the call. A guarded site contributes 0 to the
    // lower bound — counting it as 1 is how v1 reported MORE agents than actually ran.
    let guard = null;
    for (let i = 0; i < stack.length; i++) {
      const anc = stack[i], prev = i === 0 ? n : stack[i - 1];   // the child of anc on our path
      if (anc.type === 'IfStatement' && prev !== anc.test) { guard = { kind: 'if', text: sourceOf(src, anc.test, 60), line: lineOf(src, anc.start), else: prev === anc.alternate }; break; }
      if (anc.type === 'ConditionalExpression' && prev !== anc.test) { guard = { kind: 'if', text: sourceOf(src, anc.test, 60), line: lineOf(src, anc.start), else: prev === anc.alternate }; break; }
      if (anc.type === 'LogicalExpression' && prev === anc.right) { guard = { kind: 'if', text: sourceOf(src, anc.left, 60), line: lineOf(src, anc.start), else: anc.operator === '||' }; break; }
      if (anc.type === 'SwitchCase') { guard = { kind: 'if', text: anc.test ? 'case ' + sourceOf(src, anc.test, 60) : 'default', line: lineOf(src, anc.start), else: !anc.test }; break; }
      if (/^(While|DoWhile|For|ForOf|ForIn)Statement$/.test(anc.type) && prev !== anc.test) { guard = { kind: 'loop', text: sourceOf(src, anc.test || anc.right || anc, 60), line: lineOf(src, anc.start), else: false }; flags.loop = true; break; }
      if (anc.type === 'CatchClause') { guard = { kind: 'if', text: 'catch — only after a failure', line: lineOf(src, anc.start), else: false }; break; }
    }
    // A helper function is called ? times (maybe never): agent() inside one is not a sure launch.
    // Thunks in parallel([...]), .map callbacks, inline stages and IIFEs are the caller's shape and
    // count normally; a pipeline stage function is already a runtime fan-out.
    if (!guard && !stage) for (let i = 0; i < stack.length; i++) {
      const f = stack[i];
      if (!/Function/.test(f.type)) continue;
      // Skip nested arrows (`(d) => () => agent()`): what matters is where the outermost one sits.
      let j = i; while (/Function/.test(stack[j + 1]?.type || '')) j++;
      const parent = stack[j + 1];
      const helper = f.type === 'FunctionDeclaration' || stack[j].type === 'FunctionDeclaration'
        || (parent && /^(VariableDeclarator|Property|AssignmentExpression)$/.test(parent.type));
      if (!helper) break;
      const name = stack[j].id?.name || (parent?.type === 'VariableDeclarator' ? parent.id?.name : parent?.key?.name || parent?.left?.name) || '(anonymous)';
      guard = { kind: 'fn', text: `inside ${name}() — called ? times`, line: lineOf(src, f.start), else: false };
      break;
    }
    // An earlier `if (...) return` / `throw` in the same block can skip everything after it.
    if (!guard) for (let i = 0; i < stack.length; i++) {
      const blk = stack[i]; if (blk.type !== 'BlockStatement' && blk.type !== 'Program') continue;
      const mine = i === 0 ? n : stack[i - 1];
      const exits = (blk.body || []).filter((st) => st.end <= mine.start && st.type === 'IfStatement' && hasExit(st));
      if (exits.length) { guard = { kind: 'if', text: 'after early exit: ' + sourceOf(src, exits[exits.length - 1].test, 50), line: lineOf(src, exits[exits.length - 1].start), else: false }; break; }
      if (/Function/.test(stack[i + 1]?.type || '')) break;   // do not look past our own function
    }

    // Where `model:` (or `agentType:`) can be spliced in when the call has none: after the options'
    // `{`, or as a new options argument. Never beside a spread, a computed or quoted key of that name,
    // or a variable: any of them could already set it, and an insert would then change bytes but not
    // behaviour. A spread argument hides which position the options land in: `agent(...args, { model })`
    // may be a third argument the call ignores while this page reads it as the options.
    const insertFor = (key) => !isAgent || opts[key] || n.arguments.some((a) => a.type === 'SpreadElement') ? null
      : optsArg?.type === 'ObjectExpression'
        ? (optsArg.properties.some((p) => p.type !== 'Property' || p.computed || (p.key?.name ?? p.key?.value) === key) ? null
          : { at: optsArg.start + 1, empty: !optsArg.properties.length })
        : !optsArg && promptArg && n.arguments.length === 1 ? { at: promptArg.end, arg: true } : null;
    const modelInsert = insertFor('model'), typeInsert = insertFor('agentType');
    // The innermost loop whose BODY holds the call, and whether its pass count is a literal: for-of
    // over an inline or module-const array, or `i < 5`. Anything else is unbounded to this page.
    const loopAnc = stack.find((a, i) => /^(While|DoWhile|For|ForOf|ForIn)Statement$/.test(a.type) && (i === 0 ? n : stack[i - 1]) !== a.test);
    const loop = loopAnc ? { id: 'd' + loopAnc.start, bounded: /^For(Of|In)Statement$/.test(loopAnc.type)
      ? loopAnc.right?.type === 'ArrayExpression' || (loopAnc.right?.type === 'Identifier' && !!arrays[loopAnc.right.name])
      : loopAnc.type === 'ForStatement' && /^<=?$/.test(loopAnc.test?.operator || '') && typeof loopAnc.test.right?.value === 'number' } : null;
    const labelDynamic = !!opts.label && opts.label.type !== 'Literal';
    const optVal = (k) => (opts[k] == null ? null : lit(opts[k]) ?? 'computed');
    const schema = opts.schema?.type === 'ObjectExpression' ? opts.schema.properties.find((p) => p.key?.name === 'properties')?.value : null;
    if (isWf) flags.nested = true;
    const id = 'a' + nodes.length;
    const node = {
      id, kind: isWf ? 'workflow' : 'agent',
      label: isWf ? 'workflow: ' + (lit(promptArg) ?? sourceOf(src, promptArg)) : (lit(opts.label) || (labelDynamic ? sourceOf(src, opts.label) : `agent ${nodes.length + 1}`)),
      labelDynamic,
      model: optVal('model') || 'inherited',
      modelText: opts.model && !lit(opts.model) ? '⟨' + sourceOf(src, opts.model, 60) + '⟩' : null,
      modelSpan: opts.model?.type === 'Literal' ? [opts.model.start, opts.model.end] : null, modelInsert,
      effort: optVal('effort'),
      effortSpan: opts.effort?.type === 'Literal' ? [opts.effort.start, opts.effort.end] : null,
      isolation: optVal('isolation'), agentType: optVal('agentType'),
      agentTypeSpan: opts.agentType?.type === 'Literal' ? [opts.agentType.start, opts.agentType.end] : null, typeInsert,
      schemaKeys: schema?.type === 'ObjectExpression' ? schema.properties.map((p) => p.key?.name || p.key?.value).filter(Boolean) : (opts.schema ? ['⟨' + sourceOf(src, opts.schema) + '⟩'] : null),
      phase: lit(opts.phase) || phaseAt(n.start),
      mission, missionSpan, missionKind, assembled,
      fanOut, guard, loop,
      // What the prompt tells the agent to write. A static grep, honestly labelled as such.
      writesTo: [...assembled.matchAll(/\b(?:Write|write|save|Save)\b[^\n]{0,60}?((?:[A-Za-z]:\\|\/(?!\/)|⟨)[^\s`'"]*?(?:\.[a-z0-9]{1,5}|⟩))(?=[\s`'".,;:)]|$)/g)].map((m) => m[1]),
      line: lineOf(src, n.start), callText: src.slice(n.start, n.end),
    };
    nodes.push(node);
    sites.push({ node, call: n, promptArg, stack, stage });
  });

  // ---- data edges: a prior result interpolated into a later prompt --------------------------
  // Bindings: `const x = await agent(...)`, `let v = await parallel(...)`, `v = await agent(...)`.
  // The binding's producers are every site inside its initialiser. A .filter(Boolean) anywhere on
  // that initialiser clears the null warning (parallel()/pipeline() resolve failed thunks to null).
  const bindings = {};   // name → { producers: [nodeId], nullSafe }
  const bind = (id, init) => {
    if (!id || !init) return;
    const producers = sites.filter((s) => s.call.start >= init.start && s.call.end <= init.end).map((s) => s.node.id);
    if (!producers.length) return;
    const nullSafe = !/\b(parallel|pipeline)\s*\(/.test(src.slice(init.start, init.end)) || /\.filter\(\s*Boolean\s*\)/.test(src.slice(init.start, init.end));
    if (id.type === 'Identifier') bindings[id.name] = { producers, nullSafe };
    // const [a, b] = await parallel([() => agent(), () => agent()]) — the i-th name is the i-th site.
    else if (id.type === 'ArrayPattern') id.elements.forEach((el, i) => { if (el?.type === 'Identifier') bindings[el.name] = { producers: producers[i] ? [producers[i]] : producers, nullSafe }; });
    else if (id.type === 'ObjectPattern') for (const p of id.properties) if (p.value?.type === 'Identifier') bindings[p.value.name] = { producers, nullSafe };
  };
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator') bind(n.id, n.init);
    if (n.type === 'AssignmentExpression' && n.left?.type === 'Identifier') bind(n.left, n.right);
  });
  // Stage params: in pipeline(items, s1, s2), s2's first parameter is s1's result.
  const stageParam = (site) => {
    if (!site.stage || site.stage.index < 2) return null;
    const fn = site.stack.find((s) => /Function/.test(s.type));
    return fn?.params?.[0]?.type === 'Identifier' ? fn.params[0].name : null;
  };

  // Module-scope constants with a literal/template initialiser — the shared preamble every agent
  // receives, which appeared nowhere in the UI before.
  const consts = {};
  for (const st of ast.body) if (st.type === 'VariableDeclaration') for (const d of st.declarations) {
    const a = d.id?.type === 'Identifier' ? assembleOf(src, d.init) : null;
    if (a !== null) consts[d.id.name] = a;
  }

  // Where a prompt can come from, for matching only: module-scope consts and helper functions.
  const env = { vars: {}, fns: {} };
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') for (const d of st.declarations) {
      if (d.id?.type !== 'Identifier' || !d.init) continue;
      if (/Function/.test(d.init.type)) env.fns[d.id.name] = returnsOf(d.init);
      else env.vars[d.id.name] = d.init;
    }
    if (st.type === 'FunctionDeclaration' && st.id) env.fns[st.id.name] = returnsOf(st);
  }
  for (const site of sites) site.node.matchChunks = [...new Set([
    ...literalsOf(site.promptArg, env),
    ...cook(site.node.assembled).split(/⟨[^⟩]*⟩/),
    ...(site.node.fanOut?.prompts || []).flatMap((p) => cook(p).split(/⟨[^⟩]*⟩/)),
  ].map((x) => x.trim()).filter((x) => x.length >= 24))];

  const edges = [];
  const addEdge = (from, to, via, nullSafe) => {
    if (from === to || edges.some((e) => e.source === from && e.target === to)) return;
    edges.push({ id: from + '>' + to, source: from, target: to, kind: 'data', via, mayContainNull: !nullSafe });
  };
  for (const site of sites) {
    const expr = site.promptArg?.type === 'TemplateLiteral' ? site.promptArg.expressions : (site.promptArg ? [site.promptArg] : []);
    const names = new Set();
    for (const e of expr) walk(e, (x) => { if (x.type === 'Identifier') names.add(x.name); });
    for (const name of names) {
      const b = bindings[name];
      if (b) for (const p of b.producers) addEdge(p, site.node.id, name, b.nullSafe);
    }
    const param = stageParam(site);
    if (param && names.has(param)) {
      const prevStage = sites.filter((s) => s.stage?.call === site.stage.call && s.stage.index === site.stage.index - 1);
      for (const p of prevStage) addEdge(p.node.id, site.node.id, param, false);
    }
    // CONTEXT — what each interpolation resolves to. Derived, never fabricated: upstream result,
    // shared constant (with a preview), per-item value, or "runtime" when we cannot say.
    site.node.context = expr.map((e) => {
      const text = sourceOf(src, e, 48);
      // The first identifier in the expression that we can name (`JSON.stringify(survey)` → survey).
      const ids = []; walk(e, (x) => { if (x.type === 'Identifier') ids.push(x.name); });
      const name = ids.find((k) => bindings[k]) || ids.find((k) => consts[k] !== undefined) || ids.find((k) => k === param) || ids.find((k) => site.node.fanOut?.param === k) || ids[0];
      if (name && bindings[name]) return { expr: text, kind: 'upstream', producers: bindings[name].producers, mayContainNull: !bindings[name].nullSafe };
      if (name && consts[name] !== undefined) return { expr: text, kind: 'const', preview: consts[name].replace(/\s+/g, ' ').trim().slice(0, 90), chars: consts[name].length };
      if (name && param === name) return { expr: text, kind: 'upstream', producers: sites.filter((s) => s.stage?.call === site.stage.call && s.stage.index === site.stage.index - 1).map((s) => s.node.id), mayContainNull: true };
      if (name && site.node.fanOut?.over && (site.node.fanOut.param === name || /^\w+$/.test(name) && site.stack.some((s) => /Function/.test(s.type) && s.params?.some((p) => p.name === name)))) return { expr: text, kind: 'per-item' };
      return { expr: text, kind: 'runtime' };
    });
  }

  // Lower bound on agents actually launched: guarded sites count 0, static fan-outs count n,
  // runtime fan-outs count 1 (the list may be empty — but then so is the number to worry about).
  const minAgents = nodes.reduce((s, n) => s + (n.guard ? 0 : (n.fanOut ? (n.fanOut.n ?? 1) : 1)), 0);
  const flow = buildFlow(ast, sites, fnBodies, src);
  return { nodes, edges, phases, flags, minAgents, flow };
}

// ---------------------------------------------------------------- control flow
// The flowchart: what runs after what, where the script decides, where it loops back, where it
// stops. Built from the statement structure, not from data edges — a script whose agents hand
// results over through files has no data edge at all, and used to render as one flat row.
// One diamond per if/ternary/&&/switch/loop, shared by every site under it. Helpers are inlined at
// their call sites (a helper called twice is drawn once, both callers pointing in). `return` inside
// a thunk ends the thunk; at top level it ends the run; break/continue bind to the innermost loop.
// ponytail: recursion is cut at the second entry; generators and labelled statements are not modelled.
function buildFlow(ast, sites, fnBodies, src) {
  const siteOf = new Map(sites.map((s) => [s.call, s.node.id]));
  const nodes = [], edges = [], seen = new Set();
  const addNode = (id, kind, label, line) => { if (!nodes.some((x) => x.id === id)) nodes.push({ id, kind, label, line }); return id; };
  const dropNode = (id) => { const i = nodes.findIndex((x) => x.id === id); if (i >= 0) nodes.splice(i, 1); };
  const link = (froms, tos, kind = 'flow') => {
    for (const f of froms) for (const t of tos) {
      const key = f.id + '>' + t + '|' + (f.label || '');
      if (f.id === t || seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: 'f' + edges.length, source: f.id, target: t, label: f.label || '', kind });
    }
  };
  const S = (id, label) => ({ id, label });          // a sink, and the label its outgoing edge carries
  const NONE = { sources: [], sinks: [] };
  const empty = (f) => !f || (!f.sources.length && !f.sinks.length && !f.exit);
  const seq = (parts) => {
    let out = null;
    for (const p of parts) {
      if (empty(p)) continue;
      if (!out) { out = { sources: p.sources, sinks: p.sinks, exit: p.exit }; continue; }
      link(out.sinks, p.sources);
      // A part with no sources (a bare `return`, a `break`) consumes nothing: the sinks before it
      // are still the live ones, and the exit marker tells the block where to send them.
      out = { sources: out.sources, sinks: p.sources.length ? p.sinks : [...out.sinks, ...p.sinks], exit: p.exit };
    }
    return out || NONE;
  };
  const par = (parts) => (parts.length === 1 ? parts[0] : { sources: parts.flatMap((p) => p.sources), sinks: parts.flatMap((p) => p.sinks) });
  const text = (n, max = 44) => sourceOf(src, n, max);
  const inlining = new Set();
  // Where a construct's leftovers go when it exits: return/throw leave the function (or the run),
  // break/continue go to the loop. Top-level `exits` is the way to END.
  const redirect = (ctx, kind, sinks) => {
    if (!sinks.length) return;
    if (kind === 'break') (ctx.loop ? ctx.loop.breaks : ctx.exits).push(...sinks);
    else if (kind === 'continue') (ctx.loop ? ctx.loop.continues : ctx.exits).push(...sinks);
    else ctx.exits.push(...(kind === 'throw' ? sinks.map((s) => S(s.id, s.label ? s.label + ' · error' : 'error')) : sinks));
  };
  // A block runs its statements in order; the first exit ends it.
  const block = (stmts, ctx) => {
    let out = null;
    for (const st of stmts) {
      const f = flow(st, ctx);
      if (empty(f)) continue;
      const cur = seq([out, f]);
      if (f.exit) { redirect(ctx, f.exit, cur.sinks); return { sources: cur.sources, sinks: [], exit: f.exit }; }
      out = cur;
    }
    return out || NONE;
  };
  // One branch of a decision `d`; `label` is the edge leaving the diamond. Pushes what continues.
  const branch = (d, label, f, ctx, sinks) => {
    if (!f || empty(f)) { sinks.push(S(d, label)); return; }
    if (f.sources.length) { link([S(d, label)], f.sources); if (f.exit) redirect(ctx, f.exit, f.sinks); else sinks.push(...f.sinks); }
    else if (f.exit) redirect(ctx, f.exit, [S(d, label)]);
    else sinks.push(S(d, label));
  };
  const fn = (f) => {
    if (inlining.has(f)) return NONE;
    inlining.add(f);
    const ctx = { exits: [], loop: null };
    const b = f.body?.type === 'BlockStatement' ? block(f.body.body, ctx) : flow(f.body, ctx);
    inlining.delete(f);
    return { sources: b.sources, sinks: [...b.sinks, ...ctx.exits] };
  };
  const isLoopOver = (n) => n.type === 'ForOfStatement' || n.type === 'ForInStatement';

  function flow(n, ctx) {
    if (!n || typeof n.type !== 'string') return NONE;
    if (siteOf.has(n)) return { sources: [siteOf.get(n)], sinks: [S(siteOf.get(n))] };
    switch (n.type) {
      case 'Program': case 'BlockStatement': return block(n.body, ctx);
      case 'FunctionDeclaration': return NONE;                        // runs when called — see CallExpression
      case 'VariableDeclarator': return /Function/.test(n.init?.type || '') ? NONE : flow(n.init, ctx);
      case 'FunctionExpression': case 'ArrowFunctionExpression': return fn(n);
      case 'ReturnStatement': return { ...flow(n.argument, ctx), exit: 'return' };
      case 'ThrowStatement': return { ...flow(n.argument, ctx), exit: 'throw' };
      case 'BreakStatement': return { ...NONE, exit: 'break' };
      case 'ContinueStatement': return { ...NONE, exit: 'continue' };
      case 'AwaitExpression': return flow(n.argument, ctx);
      case 'IfStatement': case 'ConditionalExpression': {
        const d = addNode('d' + n.start, 'decision', text(n.test), lineOf(src, n.start)), sinks = [];
        branch(d, 'yes', flow(n.consequent, ctx), ctx, sinks);
        branch(d, 'no', n.alternate ? flow(n.alternate, ctx) : null, ctx, sinks);
        if (sinks.length === 2 && sinks.every((s) => s.id === d)) { dropNode(d); return NONE; }   // nothing under it
        return { sources: [d], sinks };
      }
      case 'LogicalExpression': {
        const l = flow(n.left, ctx), yes = n.operator === '||' ? 'no' : 'yes', no = yes === 'yes' ? 'no' : 'yes';
        const d = addNode('d' + n.start, 'decision', text(n.left), lineOf(src, n.start)), sinks = [];
        branch(d, yes, flow(n.right, ctx), ctx, sinks);
        if (sinks.length === 1 && sinks[0].id === d) { dropNode(d); return l; }
        sinks.push(S(d, no));
        return seq([l, { sources: [d], sinks }]);
      }
      case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement': case 'ForOfStatement': case 'ForInStatement': {
        const label = isLoopOver(n) ? `each ${text(n.left, 22).replace(/^(const|let|var) /, '')} of ${text(n.right, 26)}` : n.test ? text(n.test) : 'loop';
        const d = addNode('d' + n.start, 'loop', label, lineOf(src, n.start));
        const lctx = { ...ctx, loop: { breaks: [], continues: [] } };
        const b = flow(n.body, lctx);
        if (!b.sources.length && !lctx.loop.breaks.length && !lctx.loop.continues.length) { dropNode(d); return NONE; }
        link([S(d, isLoopOver(n) ? 'next' : 'yes')], b.sources);
        link([...b.sinks, ...lctx.loop.continues].map((s) => S(s.id, s.label || 'again')), [d], 'back');
        return { sources: [d], sinks: [S(d, 'done'), ...lctx.loop.breaks] };
      }
      case 'SwitchStatement': {
        const d = addNode('d' + n.start, 'decision', text(n.discriminant), lineOf(src, n.start)), sinks = [];
        const sctx = { ...ctx, loop: { breaks: [], continues: ctx.loop ? ctx.loop.continues : ctx.exits } };
        let any = false, hasDefault = false;
        for (const c of n.cases) {
          if (!c.test) hasDefault = true;
          const f = block(c.consequent, sctx);
          if (empty(f)) continue;
          any = true;
          branch(d, c.test ? 'case ' + text(c.test, 20) : 'default', f, sctx, sinks);
        }
        if (!any) { dropNode(d); return NONE; }
        sinks.push(...sctx.loop.breaks);
        if (!hasDefault) sinks.push(S(d, 'else'));
        return { sources: [d], sinks };
      }
      case 'TryStatement': {
        const b = flow(n.block, ctx), h = n.handler ? flow(n.handler.body, ctx) : NONE;
        // Any agent inside the try can be the one that throws; the first is enough to show the path.
        if (h.sources.length && b.sources.length) link(b.sources.map((id) => S(id, 'error')), h.sources, 'error');
        return seq([par([b, h]), n.finalizer ? flow(n.finalizer, ctx) : null]);
      }
      case 'CallExpression': {
        const c = n.callee;
        if (c.type === 'Identifier') {
          if (c.name === 'pipeline') return seq(n.arguments.slice(1).map((a) => flow(a, ctx)));   // stages run in order
          const f = fnBodies[c.name];
          if (f && /Function/.test(f.type)) return seq([par(n.arguments.map((a) => flow(a, ctx))), fn(f)]);
        }
        if (c.type === 'MemberExpression' && c.property?.name === 'then') return seq([flow(c.object, ctx), ...n.arguments.map((a) => flow(a, ctx))]);
        return par([flow(c, ctx), ...n.arguments.map((a) => flow(a, ctx))].filter((p) => !empty(p)));
      }
      default: {
        const parts = [];
        for (const k in n) { const v = n[k]; if (Array.isArray(v)) { for (const x of v) parts.push(flow(x, ctx)); } else if (v && typeof v.type === 'string') parts.push(flow(v, ctx)); }
        return par(parts.filter((p) => !empty(p)));
      }
    }
  }

  const top = { exits: [], loop: null };
  const main = block(ast.body, top);
  addNode('start', 'start', 'start', 0); addNode('end', 'end', 'end', 0);
  link([S('start')], main.sources);
  link([...main.sinks, ...top.exits], ['end']);
  // A site the flow never reached — a helper nobody calls, code it could not follow — hangs off
  // start with a '?', so it is on the page and honestly unexplained rather than missing.
  const reached = new Set(edges.flatMap((e) => [e.source, e.target]));
  for (const s of sites) if (!reached.has(s.node.id)) link([S('start', '?')], [s.node.id]);
  return { nodes, edges };
}

// One fan-out site, sized by the collection expression it iterates.
function sizeFanOut(src, first, arrays, stack) {
  if (!first) return { n: null, over: '(?)', labels: null };
  // An inline array of thunks is N distinct call sites, each running once — not a fan-out. v1
  // stamped ×3 on each of them, which is how it reported 17 agents for a run of 12.
  if (first.type === 'ArrayExpression') return null;
  // `X.map(cb)` over a module-scope literal array: count = X.length, labels resolved per element
  // when the label template is `prefix:${cb-param.prop}` and each element has a literal `prop`.
  const isMap = first.type === 'CallExpression' && first.callee?.type === 'MemberExpression' && first.callee.property?.name === 'map';
  const base = isMap ? first.callee.object : first;
  if (base.type === 'Identifier' && arrays[base.name]) {
    const arr = arrays[base.name];
    let labels = null;
    const cb = isMap ? first.arguments[0] : null;
    const param = cb?.params?.[0]?.name;
    // The label opt inside this fan-out, if it is `lit:${param.prop}`.
    let labelTpl = null;
    if (cb) walk(cb, (x) => { if (x.type === 'Property' && x.key?.name === 'label' && x.value?.type === 'TemplateLiteral') labelTpl = labelTpl || x.value; });
    const ex = labelTpl?.expressions?.[0];
    if (param && labelTpl && labelTpl.expressions.length === 1 && ex.type === 'MemberExpression' && ex.object?.name === param && ex.property?.name) {
      const prop = ex.property.name;
      labels = arr.elements.map((el) => {
        const p = el?.type === 'ObjectExpression' ? el.properties.find((q) => q.key?.name === prop) : null;
        return p?.value?.type === 'Literal' ? labelTpl.quasis[0].value.cooked + p.value.value + labelTpl.quasis[1].value.cooked : null;
      });
      if (labels.some((l) => l === null)) labels = null;
    }
    return { n: arr.elements.length, over: base.name, labels, items: arr.elements, param };
  }
  return { n: null, over: sourceOf(src, base), labels: null };
}

// A template or string literal as the agent will receive it, interpolations as ⟨placeholders⟩.
function assembleOf(src, node) {
  if (node?.type === 'TemplateLiteral') return node.quasis.map((qq, i) => qq.value.raw + (node.expressions[i] ? '⟨' + sourceOf(src, node.expressions[i]) + '⟩' : '')).join('');
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

// Source escapes → the characters the agent actually received. Only matching needs this: the panel
// still shows source text, and the mission splice still depends on it BEING source text.
// Unlisted escapes keep their backslash on purpose: C:\Users survives, and a string prompt (which
// acorn already cooked) can pass through here again without losing a character.
const COOK = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', '`': '`', "'": "'", '"': '"', $: '$' };
const cook = (s) => String(s).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, c) =>
  (c[0] === 'u' || c[0] === 'x') ? String.fromCodePoint(parseInt(c.replace(/[ux{}]/g, ''), 16)) : (COOK[c] ?? ('\\' + c)));

// Every literal fragment a prompt expression can yield, wherever it hides. Checked against the 21
// recorded runs on this machine: prompts are as often `a` + `b` + `c` or `promptFor(x)` as they are
// one template literal, and for those the node's `assembled` is a 40-char source snippet — enough
// to look at, nothing to match a running agent against. Used ONLY for matching: `assembled` stays
// source text so the mission tail can still be spliced back byte-for-byte.
function returnsOf(fn) {
  if (fn.body && fn.body.type !== 'BlockStatement') return [fn.body];   // arrow with an expression body
  const out = [];
  (function w(x) {
    if (!x || typeof x.type !== 'string') return;
    if (x !== fn && /Function/.test(x.type)) return;                    // not a nested function's returns
    if (x.type === 'ReturnStatement' && x.argument) out.push(x.argument);
    for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach(w); else if (v && typeof v.type === "string") w(v); }
  })(fn);
  return out;
}
function literalsOf(node, env, depth = 0) {
  if (!node || depth > 4) return [];
  const rec = (x) => literalsOf(x, env, depth + 1);
  switch (node.type) {
    case 'Literal': return typeof node.value === 'string' ? [node.value] : [];
    case 'TemplateLiteral': return node.quasis.map((q) => q.value.cooked ?? cook(q.value.raw));
    case 'BinaryExpression': return node.operator === '+' ? [...rec(node.left), ...rec(node.right)] : [];
    case 'ConditionalExpression': return [...rec(node.consequent), ...rec(node.alternate)];
    case 'Identifier': return env.vars[node.name] ? rec(env.vars[node.name]) : [];
    case 'CallExpression': return node.callee?.type === 'Identifier' && env.fns[node.callee.name]
      ? env.fns[node.callee.name].flatMap(rec) : [];
    default: return [];
  }
}

function sourceOf(src, node, max = 40) {
  if (!node) return '(?)';
  const t = src.slice(node.start, node.end).replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
// 1-based line of offset i. Line starts are indexed once per source and binary-searched: slicing and
// splitting per call was quadratic on a large, branchy script (one call per decision, loop, guard).
let LINES_OF = null, LINE_STARTS = [0];
function lineOf(src, i) {
  if (src !== LINES_OF) {
    LINES_OF = src; LINE_STARTS = [0];
    for (let k = src.indexOf('\n'); k >= 0; k = src.indexOf('\n', k + 1)) LINE_STARTS.push(k + 1);
  }
  let lo = 0, hi = LINE_STARTS.length;             // count of line starts <= i
  while (lo < hi) { const mid = (lo + hi) >> 1; if (LINE_STARTS[mid] <= i) lo = mid + 1; else hi = mid; }
  return lo;
}
// Does this statement's own body (not a nested function) return or throw?
function hasExit(st) {
  let hit = false;
  (function w(x) {
    if (hit || !x || typeof x.type !== 'string' || /Function/.test(x.type)) return;
    if (x.type === 'ReturnStatement' || x.type === 'ThrowStatement') { hit = true; return; }
    for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach(w); else if (v && typeof v.type === 'string') w(v); }
  })(st.consequent);
  if (!hit && st.alternate) (function w(x) {
    if (hit || !x || typeof x.type !== 'string' || /Function/.test(x.type)) return;
    if (x.type === 'ReturnStatement' || x.type === 'ThrowStatement') { hit = true; return; }
    for (const k in x) { const v = x[k]; if (Array.isArray(v)) v.forEach(w); else if (v && typeof v.type === 'string') w(v); }
  })(st.alternate);
  return hit;
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn));
    else if (v && typeof v.type === 'string') walk(v, fn);
  }
}
function walkWithStack(node, fn, stack = []) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, stack);
  const next = [node, ...stack];
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walkWithStack(c, fn, next));
    else if (v && typeof v.type === 'string') walkWithStack(v, fn, next);
  }
}

// ---------------------------------------------------------------- splice
// Byte splicing, not re-printing. Untouched regions are literally never re-emitted, so a no-op edit
// is byte-identical by construction. The gate fingerprints hash(script text) — anything less exact
// re-triggers the gate forever.
//
// The mission textarea is a TRUST BOUNDARY: free human text becomes executable JS. Splicing it raw
// is not a rough edge, it is three bugs — an apostrophe or newline writes a SyntaxError to the
// user's file; a backtick ends the template early; and `${process.env.X}` typed as prose becomes a
// LIVE interpolation in a script the gate then marks approved. Escape for the literal kind we are
// splicing into. Verified against all four in the format-variant harness.
function escapeForSpan(text, kind) {
  if (kind === 'string') {
    // JSON.stringify handles quotes, backslashes, newlines and control chars; drop its own quotes
    // because the source's delimiters stay in place around the span.
    const json = JSON.stringify(text).slice(1, -1);
    // JSON only escapes ", so a source using ' needs its own delimiter escaped too. Escaping both
    // is always valid JS regardless of which delimiter the source used.
    return json.replace(/'/g, "\\'");
  }
  // Template literal: a backtick would close it, and ${ would open an interpolation. Backslash must
  // go first or it would double-escape what we add after.
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const TIERS = ['fable', 'opus', 'sonnet', 'haiku'];
// An agent-type name is a verbatim registry name (`(@_@) engineer`): anything goes except what could
// close or reopen the literal it is written into. Refused, never escaped — the same check as
// advise.mjs's catalog, which never offers such a name.
const spliceableType = (s) => typeof s === 'string' && s.length > 0 && s.length <= 100 && !/['"`\\\r\n\u2028\u2029]|\$\{/.test(s);
function applyEdits(src, nodes, edits) {
  const ops = [];
  for (const n of nodes) {
    const e = edits[n.id];
    if (!e) continue;
    if (e.mission !== undefined && n.missionSpan) ops.push({ span: n.missionSpan, text: escapeForSpan(e.mission, n.missionKind) });
    // An inherited model gets a new `model:` key, and only a known tier: 'inherited' is the absence
    // of the key, never a value to write. A missing agentType likewise. Both land in ONE insert:
    // two appended options objects would leave the second one ignored by the call.
    const kvs = [], at = [];
    if (e.model !== undefined && !n.modelSpan && n.modelInsert && TIERS.includes(e.model)) { kvs.push(`model: '${e.model}'`); at.push(n.modelInsert); }
    if (e.agentType !== undefined && !n.agentTypeSpan && n.typeInsert && spliceableType(e.agentType)) { kvs.push(`agentType: '${e.agentType}'`); at.push(n.typeInsert); }
    if (kvs.length) {
      const kv = kvs.join(', '), ins = at[0];   // both inserts of a call sit at the same point
      ops.push({ span: [ins.at, ins.at], text: ins.arg ? `, { ${kv} }` : ins.empty ? ` ${kv} ` : ` ${kv},` });
    }
    // Tier and effort are bare identifiers-in-quotes; a value outside [a-z0-9.-] would be a bug
    // in the select, not in the script, so refuse rather than escape.
    for (const [k, span, ok] of [['model', n.modelSpan, (v) => /^[a-z0-9.-]+$/i.test(v)], ['effort', n.effortSpan, (v) => /^[a-z0-9.-]+$/i.test(v)], ['agentType', n.agentTypeSpan, spliceableType]]) {
      if (e[k] === undefined || !span || !ok(e[k])) continue;
      const quote = src[span[0]];   // reuse the source's own delimiter, never emit one
      ops.push({ span, text: quote + e[k] + quote });
    }
  }
  ops.sort((a, b) => b.span[0] - a.span[0]);   // right-to-left keeps earlier offsets valid
  let out = src;
  for (const o of ops) out = out.slice(0, o.span[0]) + o.text + out.slice(o.span[1]);
  return out;
}

// A tier or agent-type edit, checked before it is taken: the spliced script must parse AND re-extract
// with that value on that call site — a parse alone would pass an insert some other key silently
// overrides, and a refused name would pass as a no-op.
function withOpt(src, nodes, edits, id, key, value) {
  const next = { ...edits, [id]: { ...edits[id], [key]: value } };
  let g;
  try { g = extract(applyEdits(src, nodes, next)); } catch (e) { return { error: `the edited script would not parse (${e.message})` }; }
  const i = nodes.findIndex((x) => x.id === id);
  if (g.nodes[i]?.[key] !== value) return { error: key === 'model' ? `the call would still not run on ${value}` : `the call would still not get ${key} ${value}` };
  return { edits: next };
}
function withModel(src, nodes, edits, id, tier) { return withOpt(src, nodes, edits, id, 'model', tier); }
function withType(src, nodes, edits, id, type) { return withOpt(src, nodes, edits, id, 'agentType', type); }


export { extract, applyEdits, withModel, withOpt, TIERS }
