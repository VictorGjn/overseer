# Plan — Sample: a tiny greeting CLI

## [ ] 1. Add the hello command
done when: `node cli.js hello` prints "Hello, world"
check: ./check.sh

## [ ] 2. Add a --name flag
done when: `node cli.js hello --name Ada` prints "Hello, Ada"
check: ./check.sh name
depends: 1

## [ ] 3. Document both commands
done when: README.md shows both commands
depends: 2
