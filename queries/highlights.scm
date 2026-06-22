; Syntax highlighting for Charon's pretty-printed IR (ULLBC and LLBC dumps).

; ----- Comments -----------------------------------------------------------
(line_comment) @comment
(header_comment) @comment

; ----- Literals -----------------------------------------------------------
(integer) @number
(float) @number
(string) @string
(byte_string) @string
(char) @string
(boolean) @boolean
(lifetime) @label
(builtin_body) @constant.builtin
(opaque_const) @constant.builtin
(no_provenance) @constant.builtin

; ----- Labels / disambiguators -------------------------------------------
(block_id) @label
(name_group) @label

; ----- Attributes ---------------------------------------------------------
(attribute (identifier) @attribute)
(attribute ["#[" "]"] @punctuation.bracket)

; ----- Built-in types -----------------------------------------------------
(primitive_type) @type.builtin
(never_type) @type.builtin
(unit_type) @type.builtin
(wildcard_type) @type.builtin

; ----- Declaration names --------------------------------------------------
(function_item name: (path (path_segment (identifier) @function)))
(method_decl name: (identifier) @function)
(struct_item name: (path (path_segment (identifier) @type)))
(union_item name: (path (path_segment (identifier) @type)))
(enum_item name: (path (path_segment (identifier) @type)))
(trait_item name: (path (path_segment (identifier) @type)))
(type_alias_item name: (path (path_segment (identifier) @type)))
(assoc_type (identifier) @type)
(impl_item trait: (path (path_segment (identifier) @type)))
(impl_item type: (path (path_segment (identifier) @type)))
(global_item name: (path (path_segment (identifier) @constant)))

; ----- Calls / builtins ---------------------------------------------------
(call_expression function: (path (path_segment (identifier) @function)))
(at_name) @function.builtin
(type_error) @function.builtin

; ----- Aggregates ---------------------------------------------------------
(aggregate type: (path (path_segment (identifier) @type)))

; ----- Fields, params, locals --------------------------------------------
(field_declaration name: (identifier) @property)
(field_initializer name: (identifier) @property)
(variant name: (identifier) @constant)
(parameter name: (identifier) @variable.parameter)
(place field: (identifier) @property)
(offset_of field: (identifier) @property)
"metadata" @property

; ----- Keywords -----------------------------------------------------------
(visibility) @keyword
(non_dyn_compatible) @keyword

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
  "two-phase-mut"
  "uniq"
  "shallow"
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
  "break"
  "continue"
  "nop"
  "switch"
  "if"
  "else"
  "match"
  "loop"
  "panic"
  "undefined_behavior"
  "unwind_terminate"
  "unwind_continue"
  "unwind_unreachable"
  "unreachable"
  "assert"
  "drop"
  "conditional_drop"
  "with_metadata"
  "otherwise"
  "unwind"
  "asm!"
  "target"
] @keyword

[
  "cast"
  "transmute"
  "unsize_cast"
  "concretize"
  "ub_checks"
  "overflow_checks"
  "contract_checks"
  "offset_of"
  "variant"
  "at"
  "no-provenance"
] @keyword.operator

; ----- Operators ----------------------------------------------------------
(binary_operator) @operator
(checked_binary_operator) @operator
(checked_unary_operator) @operator

[
  ":="
  "->"
  "=>"
  "="
  "~"
  "&"
  "*"
  ".."
  "..="
  "+"
] @operator

; ----- Punctuation --------------------------------------------------------
[ "(" ")" "[" "]" "{" "}" "<" ">" ] @punctuation.bracket
[ "," ";" ":" "::" "." "|" ] @punctuation.delimiter

; ----- Identifier heuristics (fallback) -----------------------------------
; Rust naming conventions: SCREAMING_CASE -> constant, CamelCase -> type.
((identifier) @constant
  (#match? @constant "^[A-Z][A-Z0-9_]+$"))
((identifier) @type
  (#match? @type "^[A-Z]"))
(identifier) @variable
