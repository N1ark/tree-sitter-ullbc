#include "tree_sitter/parser.h"

// External scanner for ULLBC `switch` char-discriminant arms.
//
// Char constants are pretty-printed as bare glyphs, so a `switch` over a `char`
// can have arm values that the regular lexer cannot handle: a literal NUL byte
// (which tree-sitter reserves as its EOF sentinel) or a lone `"` (which the
// internal lexer would greedily start a string with). This scanner consumes a
// single such glyph as a `switch_char` token, leaving every ordinary arm value
// (booleans, integers, `_`, the `->` arrow) to the normal grammar.

enum TokenType {
  SWITCH_CHAR,
};

void *tree_sitter_ullbc_external_scanner_create(void) { return NULL; }
void tree_sitter_ullbc_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_ullbc_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_ullbc_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_ullbc_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  if (!valid_symbols[SWITCH_CHAR]) {
    return false;
  }

  // Skip layout whitespace; the value glyph follows it.
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\n' || lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }

  if (lexer->eof(lexer)) {
    return false;
  }

  int32_t c = lexer->lookahead;

  // Defer ordinary arm values and arm/terminator punctuation to the grammar:
  //   identifiers/keywords, integers, `_`, the `-` of `->`, `]`, `;`.
  if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') || c == '_' || c == '-' || c == ']' || c == ';') {
    return false;
  }

  // Anything else is a bare char-literal glyph (`"`, `'`, `\`, `+`, NUL, ...).
  lexer->advance(lexer, false);
  lexer->result_symbol = SWITCH_CHAR;
  lexer->mark_end(lexer);
  return true;
}
