; Syntax highlighting for ULLBC crate dumps (Charon's pretty-printed IR).

; ----- Comments -----------------------------------------------------------
(line_comment) @comment

; ----- Literals -----------------------------------------------------------
(integer) @number
(float) @number
(string) @string
(byte_string) @string
(char) @string
(boolean) @boolean
(lifetime) @label
(builtin_body) @constant.builtin

; ----- Labels -------------------------------------------------------------
(block_id) @label
(closure_id) @label

; ----- Attributes ---------------------------------------------------------
(attribute (identifier) @attribute)
(attribute ["#[" "]"] @punctuation.bracket)

; ----- Built-in types -----------------------------------------------------
(primitive_type) @type.builtin
(never_type) @type.builtin
(unit_type) @type.builtin

; ----- Declarations: names ------------------------------------------------
(function_item name: (path (path_segment (identifier) @function)))
(struct_item name: (path (path_segment (identifier) @type)))
(union_item name: (path (path_segment (identifier) @type)))
(enum_item name: (path (path_segment (identifier) @type)))
(trait_item name: (path (path_segment (identifier) @type)))
(type_alias_item name: (path (path_segment (identifier) @type)))
(impl_item type: (path (path_segment (identifier) @type)))
(global_item name: (path (path_segment (identifier) @constant)))

; ----- Calls --------------------------------------------------------------
(call_expression function: (path (path_segment (identifier) @function)))

; ----- Aggregate construction ---------------------------------------------
(aggregate type: (path (path_segment (identifier) @type)))

; ----- Fields and parameters ----------------------------------------------
(field_declaration name: (identifier) @property)
(field_initializer name: (identifier) @property)
(variant name: (identifier) @constant)
(parameter name: (identifier) @variable.parameter)
(place field: (identifier) @property)
"metadata" @property

; ----- Keywords -----------------------------------------------------------
(visibility) @keyword

[
  "fn"
  "struct"
  "union"
  "enum"
  "trait"
  "impl"
  "type"
  "const"
  "static"
  "thread_local"
  "opaque"
  "let"
  "where"
  "unsafe"
  "extern"
  "proof"
  "vtable"
] @keyword

[
  "dyn"
  "for"
  "as"
  "is"
  "mut"
  "raw"
  "null"
] @keyword

[
  "move"
  "copy"
] @keyword

[
  "storage_live"
  "storage_dead"
  "goto"
  "return"
  "switch"
  "panic"
  "undefined_behavior"
  "unwind_terminate"
  "unwind_continue"
  "unwind_unreachable"
  "unreachable"
  "unwind"
  "assert"
  "else"
  "drop"
  "nop"
  "with_metadata"
] @keyword

[
  "cast"
  "transmute"
  "unsize_cast"
  "concretize"
  "size_of"
  "align_of"
  "offset_of"
  "ub_checks"
  "overflow_checks"
  "contract_checks"
  "len"
  "variant"
  "at"
] @keyword.operator

"@discriminant" @keyword.operator

; `const` used as an operand prefix keeps the keyword colour above.

; ----- Operators ----------------------------------------------------------
(binary_operator) @operator
(checked_binary_operator) @operator
(checked_unary_operator) @operator

[
  ":="
  "->"
  "="
  "~"
  "&"
  "*"
  "..="
] @operator

; ----- Punctuation --------------------------------------------------------
[ "(" ")" "[" "]" "{" "}" "<" ">" ] @punctuation.bracket
[ "," ";" ":" "::" "." ] @punctuation.delimiter

; ----- Identifier heuristics (fallback) -----------------------------------
; Rust naming conventions: SCREAMING_CASE -> constant, CamelCase -> type.
((identifier) @constant
  (#match? @constant "^[A-Z][A-Z0-9_]+$"))
((identifier) @type
  (#match? @type "^[A-Z]"))
(identifier) @variable
