// TSTL plugin: emit Luau bit32.* calls for JS bitwise operators.
//
// TSTL's Lua 5.1 target (the Luau-compatible one: no goto, no native bitwise
// operator syntax) rejects bitwise expressions outright; this plugin
// intercepts them and emits bit32 library calls instead, which Luau provides.
//
// CONTRACT: operands must be integers (bit32 errors on fractions, unlike
// JS ToInt32 which truncates). The shared sim honors this — the only bitwise
// users are the PRNG/imul in sim.ts and seed normalization in brain.ts, all
// integer chains; the one fractional `| 0` truncation was rewritten to
// Math.floor upstream. bit32 returns unsigned where JS returns signed; the
// values differ by multiples of 2^32, which every downstream reduction in
// mulberry32/imul erases (see the imul comment in sim.ts). The replay parity
// harness enforces all of this.
const ts = require("typescript");
const lua = require("typescript-to-lua");

const BIT_BINOPS = new Map([
  [ts.SyntaxKind.AmpersandToken, "band"],
  [ts.SyntaxKind.BarToken, "bor"],
  [ts.SyntaxKind.CaretToken, "bxor"],
  [ts.SyntaxKind.LessThanLessThanToken, "lshift"],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, "arshift"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, "rshift"],
]);

function bit32Call(name, args, node) {
  return lua.createCallExpression(
    lua.createTableIndexExpression(lua.createIdentifier("bit32"), lua.createStringLiteral(name)),
    args,
    node,
  );
}

module.exports = {
  visitors: {
    [ts.SyntaxKind.BinaryExpression](node, context) {
      const op = BIT_BINOPS.get(node.operatorToken.kind);
      if (op !== undefined) {
        return bit32Call(
          op,
          [context.transformExpression(node.left), context.transformExpression(node.right)],
          node,
        );
      }
      return context.superTransformExpression(node);
    },
    [ts.SyntaxKind.PrefixUnaryExpression](node, context) {
      if (node.operator === ts.SyntaxKind.TildeToken) {
        return bit32Call("bnot", [context.transformExpression(node.operand)], node);
      }
      return context.superTransformExpression(node);
    },
  },
};
