/**
 * tree-sitter grammar for ULLBC crate dumps (Charon's pretty-printed IR).
 *
 * This grammar is tolerant by design: its purpose is syntax highlighting, so
 * the expression/place sub-grammar is intentionally permissive rather than a
 * faithful semantic model. It is validated against real `*.ullbc.crate` dumps.
 */

const PRIMITIVE_TYPES = [
  'usize', 'u8', 'u16', 'u32', 'u64', 'u128',
  'isize', 'i8', 'i16', 'i32', 'i64', 'i128',
  'f16', 'f32', 'f64', 'f128',
  'bool', 'char', 'str',
];

const sep1 = (rule, s) => seq(rule, repeat(seq(s, rule)));
const sepComma = (rule) => optional(seq(sep1(rule, ','), optional(',')));

module.exports = grammar({
  name: 'ullbc',

  extras: ($) => [/\s/, $.line_comment],

  // `switch_char` is produced by the external scanner (src/scanner.c). Char
  // discriminants are pretty-printed as bare glyphs, including bytes that the
  // internal lexer cannot represent (NUL) or would mis-lex (a lone `"`).
  externals: ($) => [$.switch_char],

  word: ($) => $.identifier,

  conflicts: ($) => [
    [$._expression, $._place_inner],
    [$.path_segment],
  ],

  rules: {
    source_file: ($) => repeat($._item),

    line_comment: ($) => token(seq('//', /.*/)),

    _item: ($) =>
      choice(
        $.attribute,
        $.function_item,
        $.struct_item,
        $.union_item,
        $.enum_item,
        $.trait_item,
        $.impl_item,
        $.global_item,
        $.type_alias_item,
      ),

    // ----- Attributes ---------------------------------------------------
    attribute: ($) => seq('#[', $._attr_contents, ']'),
    _attr_contents: ($) =>
      seq(
        $.identifier,
        optional(seq('(', sepComma(choice($.string, $.integer, $.identifier)), ')')),
      ),

    // ----- Visibility / qualifiers --------------------------------------
    visibility: ($) => 'pub',
    extern_abi: ($) => seq('extern', optional($.string)),

    // ----- Functions ----------------------------------------------------
    function_item: ($) =>
      seq(
        optional($.visibility),
        optional('unsafe'),
        optional($.extern_abi),
        'fn',
        field('name', $.path),
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $._type))),
        optional($.where_clause),
        choice(
          field('body', $.block_body),
          seq('=', field('body', $._fn_definition)),
        ),
      ),

    parameters: ($) => seq('(', sepComma($.parameter), ')'),
    parameter: ($) => seq(field('name', $.identifier), ':', field('type', $._type)),

    _fn_definition: ($) => choice($.builtin_body, $._expression),

    builtin_body: ($) =>
      token(
        choice(
          seq('<intrinsic:', /[^>]*/, '>'),
          seq('<extern:', /[^>]*/, '>'),
          '<opaque>',
          '<built-in>',
          '<global>',
        ),
      ),

    block_body: ($) =>
      seq('{', repeat($.local_decl), repeat($.basic_block), '}'),

    local_decl: ($) =>
      seq('let', field('name', $.path), ':', field('type', $._type), ';'),

    // ----- Basic blocks -------------------------------------------------
    basic_block: ($) =>
      seq(field('label', $.block_id), '{', repeat($._statement), '}'),

    block_id: ($) => token(seq('block@', /\d+/)),

    _statement: ($) =>
      choice(
        $.storage_statement,
        $.assign_statement,
        $.call_statement,
        $.intrinsic_statement,
        $.assert_statement,
        $.switch_statement,
        $.goto_statement,
        $.return_statement,
        $.panic_statement,
        $.unwind_statement,
        $.nop_statement,
        $.drop_statement,
      ),

    storage_statement: ($) =>
      seq(choice('storage_live', 'storage_dead'), $.place, ';'),

    assign_statement: ($) =>
      seq(field('lhs', $.place), ':=', field('rhs', $._expression), ';'),

    call_statement: ($) =>
      seq(
        optional(seq(field('lhs', $.place), '=')),
        field('callee', $.call_expression),
        '->',
        $.call_target,
        ';',
      ),

    call_expression: ($) =>
      seq(
        field('function', choice($.path, seq('(', $._expression, ')'))),
        '(',
        sepComma($._expression),
        ')',
      ),

    call_target: ($) =>
      seq($.block_id, optional(seq('(', 'unwind', ':', $.block_id, ')'))),

    // Intrinsic statements without a terminator, e.g.
    // `copy_non_overlapping(move _1, move _2, move _3);`
    intrinsic_statement: ($) => seq($.call_expression, ';'),

    assert_statement: ($) =>
      seq(
        'assert',
        '(',
        $._expression,
        ')',
        'else',
        field('on_failure', $.identifier),
        ';',
      ),

    switch_statement: ($) =>
      seq('switch', $._expression, '[', sep1($.switch_arm, ';'), ']', ';'),
    // The value is optional: char discriminants are pretty-printed as bare
    // glyphs, and whitespace-valued arms (space/tab/newline) are consumed as
    // layout — we still recover the `-> block@N` target cleanly.
    switch_arm: ($) =>
      seq(
        optional(field('value', choice($._expression, $.switch_char, '_'))),
        '->',
        $.block_id,
      ),

    goto_statement: ($) => seq('goto', $.block_id, ';'),
    return_statement: ($) => seq('return', ';'),
    panic_statement: ($) =>
      seq(choice('panic', 'undefined_behavior', 'unwind_terminate'), ';'),
    unwind_statement: ($) =>
      seq(choice('unwind_continue', 'unwind_unreachable', 'unreachable'), ';'),
    nop_statement: ($) => seq('nop', ';'),
    drop_statement: ($) =>
      seq('drop', $.place, optional(seq('->', $.call_target)), ';'),

    // ----- Data type declarations --------------------------------------
    struct_item: ($) =>
      seq(
        optional($.visibility),
        'struct',
        field('name', $.path),
        optional($.where_clause),
        $.field_list,
      ),
    union_item: ($) =>
      seq(
        optional($.visibility),
        'union',
        field('name', $.path),
        optional($.where_clause),
        $.field_list,
      ),

    field_list: ($) => seq('{', sepComma($.field_declaration), '}'),
    field_declaration: ($) =>
      seq(field('name', choice($.identifier, $.integer)), ':', field('type', $._type)),

    enum_item: ($) =>
      seq(
        optional($.visibility),
        'enum',
        field('name', $.path),
        optional($.where_clause),
        $.variant_list,
      ),
    variant_list: ($) => seq('{', sepComma($.variant), '}'),
    variant: ($) =>
      seq(
        field('name', $.identifier),
        optional(seq('(', sepComma($.field_declaration), ')')),
      ),

    // ----- Traits & impls ----------------------------------------------
    trait_item: ($) =>
      seq(
        optional($.visibility),
        'trait',
        field('name', $.path),
        optional($.where_clause),
        optional($.trait_body),
      ),
    trait_body: ($) => seq('{', repeat($._trait_member), '}'),
    _trait_member: ($) =>
      choice(
        $.proof_statement,
        $.assoc_type,
        $.assoc_const,
        $.function_item,
        $.vtable_member,
      ),
    proof_statement: ($) =>
      seq('proof', $.identifier, ':', $._type, optional(seq('=', $._type)), ';'),
    vtable_member: ($) => seq('vtable', ':', $._type, optional(';')),

    impl_item: ($) =>
      seq(
        optional($.visibility),
        'impl',
        optional($.string),
        field('type', $._type),
        optional($.where_clause),
        $.impl_body,
      ),
    impl_body: ($) => seq('{', repeat($._trait_member), '}'),

    // ----- Globals / consts / statics ----------------------------------
    global_item: ($) =>
      seq(
        optional($.visibility),
        optional('thread_local'),
        choice('const', 'static'),
        field('name', $.path),
        ':',
        field('type', $._type),
        optional(seq('=', field('value', $._expression))),
      ),

    type_alias_item: ($) =>
      seq(
        optional($.visibility),
        optional('opaque'),
        'type',
        field('name', $.path),
        optional($.where_clause),
        optional(seq('=', field('value', $._type))),
      ),

    assoc_type: ($) =>
      seq('type', $.path, optional(seq('=', $._type)), ';'),
    assoc_const: ($) =>
      seq('const', $.identifier, ':', $._type, optional(seq('=', $._expression)), ';'),

    where_clause: ($) => prec.right(seq('where', repeat1(seq($.where_predicate, ',')))),
    where_predicate: ($) => seq($._type, ':', $._type),

    // ----- Types --------------------------------------------------------
    _type: ($) =>
      choice(
        $.primitive_type,
        $.never_type,
        $.unit_type,
        $.tuple_type,
        $.reference_type,
        $.pointer_type,
        $.slice_type,
        $.array_type,
        $.dyn_type,
        $.fn_type,
        $.refined_type,
        $.path,
      ),

    primitive_type: ($) => choice(...PRIMITIVE_TYPES),
    never_type: ($) => '!',
    unit_type: ($) => seq('(', ')'),
    tuple_type: ($) => seq('(', sep1($._type, ','), optional(','), ')'),

    reference_type: ($) =>
      seq('&', optional($.lifetime), optional('mut'), $._type),
    pointer_type: ($) => seq('*', choice('const', 'mut'), $._type),
    slice_type: ($) => seq('[', $._type, ']'),
    array_type: ($) => seq('[', $._type, ';', $._expression, ']'),
    dyn_type: ($) => prec.right(seq('dyn', $._type)),
    fn_type: ($) =>
      seq(
        optional($.for_lifetimes),
        optional('unsafe'),
        optional($.extern_abi),
        'fn',
        '(',
        sepComma($._type),
        ')',
        optional(seq('->', $._type)),
      ),
    for_lifetimes: ($) => seq('for', '<', sepComma($.lifetime), '>'),

    // `*const () is !null`, `usize is 1usize..=9usize`
    refined_type: ($) => prec(1, seq($._type, 'is', $._type_pattern)),
    _type_pattern: ($) =>
      choice(
        $.not_null_pattern,
        $.range_pattern,
        seq('(', sep1($._type_pattern, '|'), ')'),
      ),
    not_null_pattern: ($) => seq('!', 'null'),
    range_pattern: ($) =>
      seq(choice($.integer, $.float, $.path), '..=', choice($.integer, $.float, $.path)),

    // ----- Paths (names with turbofish/qualified segments) --------------
    path: ($) =>
      choice(
        seq(optional('::'), sep1($.path_segment, '::')),
        $.qualified_path,
      ),
    qualified_path: ($) =>
      seq('<', $._type, 'as', $._type, '>', repeat(seq('::', $.path_segment))),
    path_segment: ($) =>
      choice(
        prec.dynamic(1, seq($.identifier, $.generic_arguments)),
        $.identifier,
        $.generic_arguments,
        $.closure_id,
      ),
    closure_id: ($) => token(seq('{', /[a-zA-Z_]+/, optional(seq('#', /\d+/)), '}')),
    generic_arguments: ($) =>
      seq('<', sepComma($.generic_argument), '>'),
    generic_argument: ($) =>
      choice($.lifetime, $.impl_argument, $._type, $.integer),
    impl_argument: ($) =>
      seq('impl', $._type, optional(seq('for', $._type))),

    lifetime: ($) => token(seq("'", choice('_', /[A-Za-z_][A-Za-z0-9_]*/, /\d+/))),

    // ----- Expressions / rvalues / operands -----------------------------
    _expression: ($) =>
      choice(
        $.operand,
        $.borrow,
        $.cast_expression,
        $.nullary_op,
        $.discriminant,
        $.unary_expression,
        $.binary_expression,
        $.aggregate,
        $.raw_pointer_aggregate,
        $.array_expression,
        $.repeat_expression,
        $.tuple_expression,
        $.call_expression,
        $.len_expression,
        $.boolean,
        $.integer,
        $.float,
        $.string,
        $.byte_string,
        $.char,
        $.unit_expression,
        $.place,
      ),

    operand: ($) =>
      choice(
        seq('copy', $.place),
        seq('move', $.place),
        seq('const', $._constant),
      ),

    _constant: ($) =>
      choice(
        $.boolean,
        $.float,
        $.integer,
        $.string,
        $.byte_string,
        $.char,
        $.raw_char,
        $.unit_expression,
        $.aggregate,
        $.array_expression,
        $.raw_pointer_aggregate,
        $.borrow,
        $.path,
      ),

    // Char constants are pretty-printed as bare glyphs (e.g. `const -`).
    // Only reachable where a constant is expected, so it never shadows
    // real operator/punctuation tokens elsewhere.
    raw_char: ($) => token(prec(-2, /[^\s]/)),

    borrow: ($) =>
      seq(
        $.borrow_kind,
        choice($.place, $.array_expression),
        optional($.with_metadata),
      ),
    borrow_kind: ($) =>
      choice(
        seq('&', 'raw', choice('const', 'mut')),
        seq('&', optional(choice('mut', 'two-phase-mut', 'uniq', 'shallow'))),
      ),
    with_metadata: ($) => seq('with_metadata', '(', $._expression, ')'),

    cast_expression: ($) =>
      seq(
        choice('cast', 'transmute', 'unsize_cast', 'concretize'),
        '<',
        sepComma(choice($._type, $.integer, $.cast_metadata)),
        '>',
        '(',
        $._expression,
        ')',
      ),
    cast_metadata: ($) => seq('at', '[', sepComma($._expression), ']'),

    nullary_op: ($) =>
      seq(
        choice('size_of', 'align_of', 'offset_of', 'ub_checks', 'overflow_checks', 'contract_checks'),
        '<',
        sepComma(choice($._type, $.integer)),
        '>',
      ),

    discriminant: ($) => seq('@discriminant', '(', $.place, ')'),

    len_expression: ($) => seq('len', '(', $.place, ')'),

    unary_expression: ($) =>
      prec(8, choice(
        seq('~', $._expression),
        seq($.checked_unary_operator, '(', $._expression, ')'),
      )),
    checked_unary_operator: ($) => token(/(panic|wrap|ub)\.-/),

    binary_expression: ($) =>
      prec.left(4, seq($._expression, $.binary_operator, $._expression)),
    binary_operator: ($) =>
      choice(
        '==', '!=', '<=', '>=', '<', '>',
        '&', '|', '^', '+', '-', '*', '/', '%',
        'cmp', 'offset',
        $.checked_binary_operator,
      ),
    checked_binary_operator: ($) =>
      token(/(panic|wrap|ub|checked)\.(<<|>>|\+|-|\*|\/|%|&|\||\^)/),

    // `Type { field: op }`, `Path::Variant { 0: op }`, `Type {  }`
    aggregate: ($) =>
      prec(2, seq(field('type', $.path), '{', sepComma($.field_initializer), '}')),
    field_initializer: ($) =>
      seq(field('name', choice($.identifier, $.integer)), ':', field('value', $._expression)),

    // `*const (move _3, move _4)` / `*mut (...)` — raw pointer from parts
    raw_pointer_aggregate: ($) =>
      seq('*', choice('const', 'mut'), '(', sepComma($._expression), ')'),

    array_expression: ($) => seq('[', sepComma($._expression), ']'),
    repeat_expression: ($) => seq('[', $._expression, ';', $._expression, ']'),
    tuple_expression: ($) => seq('(', sep1($._expression, ','), optional(','), ')'),
    unit_expression: ($) => seq('(', ')'),

    // ----- Places -------------------------------------------------------
    place: ($) =>
      prec.left(seq($._place_atom, repeat($._place_projection))),
    _place_atom: ($) =>
      choice(
        $.path,
        $.parenthesized_place,
      ),
    parenthesized_place: ($) =>
      seq('(', $._place_inner, ')'),
    _place_inner: ($) =>
      choice(
        seq('*', $.place),
        $.variant_projection,
        $.place,
      ),
    variant_projection: ($) =>
      seq($.place, 'as', 'variant', $._type),
    _place_projection: ($) =>
      choice(
        seq('.', field('field', choice($.identifier, $.integer, 'metadata'))),
        $.index_projection,
      ),
    index_projection: ($) => seq('[', $._expression, ']'),

    // ----- Literals -----------------------------------------------------
    boolean: ($) => choice('true', 'false'),

    integer: ($) =>
      token(
        seq(
          optional('-'),
          choice(/[0-9]+/, /0x[0-9a-fA-F]+/, /0b[01]+/, /0o[0-7]+/),
          optional(/(u|i)(8|16|32|64|128|size)/),
        ),
      ),

    float: ($) =>
      token(seq(optional('-'), /[0-9]+\.[0-9]+/, optional(/f(16|32|64|128)/))),

    string: ($) => token(seq('"', repeat(choice(/[^"\\]/, /\\./)), '"')),
    byte_string: ($) => token(seq('b"', repeat(choice(/[^"\\]/, /\\./)), '"')),
    char: ($) => token(seq("'", choice(/[^'\\]/, /\\./), "'")),

    identifier: ($) => /[A-Za-z_][A-Za-z0-9_]*/,
  },
});
