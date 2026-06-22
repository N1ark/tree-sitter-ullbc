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

  // A `'` may open a well-formed quoted char literal (newer dumps, e.g.
  // `'\u{0}'`) or be a bare `'` glyph (older raw dumps). Peek for a closing
  // quote: if found, defer to the internal `char` token; otherwise emit the
  // lone `'` as a switch_char. Returning false resets the lexer position.
  if (c == '\'') {
    lexer->advance(lexer, false);  // past the opening quote
    lexer->mark_end(lexer);        // fallback token is just "'"
    for (int i = 0; i < 16 && !lexer->eof(lexer); i++) {
      int32_t d = lexer->lookahead;
      if (d == '\'') {
        return false;  // closing quote -> quoted char literal, defer
      }
      if (d == ' ' || d == '\t' || d == '\n' || d == '\r' ||
          d == ']' || d == ';' || d == '>' || d == 0) {
        break;  // delimiter before any closing quote -> it was a bare `'`
      }
      lexer->advance(lexer, false);
    }
    lexer->result_symbol = SWITCH_CHAR;
    return true;  // token spans the marked end (the lone `'`)
  }

  // Anything else is a bare char-literal glyph (`"`, `\`, `+`, NUL, ...).
  lexer->advance(lexer, false);
  lexer->result_symbol = SWITCH_CHAR;
  lexer->mark_end(lexer);
  return true;
}
