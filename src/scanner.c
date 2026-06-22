#include "tree_sitter/parser.h"

// External scanner for Charon IR dumps.
//
// NAME_GROUP: a `{...}` name disambiguator (`{closure#0}`, `{vtable}`,
// `{built_in impl Destruct for A}`, `{V<T, N>[TraitClause0]}`, ...). These may
// nest, so a regex token cannot match them; we scan balanced braces. They are
// told apart from an ordinary `{ ... }` body (struct/enum/aggregate/block) by
// the absence of a leading space or newline after `{`.

enum TokenType {
  NAME_GROUP,
};

void *tree_sitter_ullbc_external_scanner_create(void) { return NULL; }
void tree_sitter_ullbc_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_ullbc_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_ullbc_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static bool scan_name_group(TSLexer *lexer) {
  // Called with lookahead at `{`.
  lexer->advance(lexer, false);
  // A `{ ... }` body always has a space/newline right after the brace, and an
  // empty `{}` body is never a name group.
  if (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
      lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
      lexer->lookahead == '}' || lexer->eof(lexer)) {
    return false;
  }
  int depth = 1;
  while (depth > 0 && !lexer->eof(lexer)) {
    if (lexer->lookahead == '{') {
      depth++;
    } else if (lexer->lookahead == '}') {
      depth--;
    }
    lexer->advance(lexer, false);
  }
  if (depth != 0) {
    return false;
  }
  lexer->result_symbol = NAME_GROUP;
  lexer->mark_end(lexer);
  return true;
}

bool tree_sitter_ullbc_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  if (!valid_symbols[NAME_GROUP]) {
    return false;
  }
  // The external scanner runs before extras are consumed, so a name group
  // preceded by whitespace would otherwise be missed.
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\n' || lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
  if (lexer->lookahead == '{') {
    return scan_name_group(lexer);
  }
  return false;
}
