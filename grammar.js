/**
 * tree-sitter grammar for Charon's pretty-printed IR crate dumps.
 *
 * Charon emits two dialects of the same surface language:
 *   - ULLBC (unstructured): functions are basic blocks `bbN: { ... }` ending in
 *     an explicit terminator (`goto`, `switch ... -> ...`, calls with
 *     `-> bbN (unwind: bbM)`, ...); statements end with `;`.
 *   - LLBC (structured): functions use `if`/`match`/`switch { }`/`loop`; there
 *     are no basic blocks and no statement-terminating `;`.
 *
 * The two share the item, type, rvalue/operand, place and literal layers. The
 * grammar is deliberately tolerant: its purpose is syntax highlighting, so the
 * expression sub-grammar is permissive rather than a faithful semantic model.
 * It is validated against Charon's `charon/tests/ui/*.out` corpus.
 */

const PRIMITIVE_TYPES = [
  'usize', 'u8', 'u16', 'u32', 'u64', 'u128',
  'isize', 'i8', 'i16', 'i32', 'i64', 'i128',
  'f16', 'f32', 'f64', 'f128',
  'bool', 'char', 'str',
];

const sep1 = (rule, s) => seq(rule, repeat(seq(s, rule)));
const sepComma = (rule) => optional(seq(sep1(rule, ','), optional(',')));
const sepBar = (rule) => sep1(rule, '|');
const semi = () => optional(';');

module.exports = grammar({
  name: 'ullbc',

  extras: ($) => [/\s/, $.line_comment, $.header_comment],

  // External token (src/scanner.c): `name_group` is a `{...}` name
  // disambiguator with balanced (possibly nested) braces, distinguished from a
  // `{ ... }` body by the absence of a leading space/newline.
  externals: ($) => [$.name_group],

  word: ($) => $.identifier,

  conflicts: ($) => [
    [$.path_segment],
    [$.impl_item, $.path_segment],
    [$.wildcard_type, $.reference_type],
    [$._predicate_body],
    [$._abort_kind],
    [$.clause_typed, $._place_atom],
    [$.where_clause],
    [$.assoc_type, $.path_segment],
    [$.assoc_const, $.path_segment],
    [$._predicate_body, $.hrtb_type],
    [$._expression, $._place_inner],
    [$.path],
    [$._predicate_tail],
    [$.storage_statement, $._place_inner],
    [$.call_target],
    [$.call_expression, $._place_atom],
    [$.reference_type, $.borrow_kind],
    [$._constant, $.call_expression],
    [$.switch_arm, $.binary_operator],
    [$.tuple_expression, $.call_expression],
    [$.qualified_path],
  ],

  rules: {
    source_file: ($) => repeat($._item),

    line_comment: ($) => token(seq('//', /.*/)),
    // The dump's banner line, e.g. `# Final LLBC before serialization:`.
    header_comment: ($) => token(seq('# ', /.*/)),

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
        optional(
          choice(
            field('body', $.block_body),
            seq('=', field('body', $._fn_definition)),
          ),
        ),
      ),

    parameters: ($) => seq('(', sepComma($.parameter), ')'),
    parameter: ($) => seq(field('name', $.identifier), ':', field('type', $._type)),

    // A function body is either an opaque/builtin marker or a reference to
    // another function item (a path, possibly with trait-clause refs).
    _fn_definition: ($) => choice($.builtin_body, $._type),

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
      seq('{', repeat(choice($.local_decl, $.basic_block, $._statement)), '}'),

    local_decl: ($) =>
      seq('let', field('name', $.path), ':', field('type', $._type), ';'),

    // ----- Basic blocks (ULLBC) ----------------------------------------
    basic_block: ($) =>
      seq(field('label', $.block_id), '{', repeat($._statement), '}'),

    // `bb0:` / `bb0` (also legacy `block@0`).
    block_id: ($) => token(seq(choice('block@', 'bb'), /\d+/, optional(':'))),

    // ----- Statements ---------------------------------------------------
    _statement: ($) =>
      choice(
        $.assign_statement,
        $.storage_statement,
        $.call_statement,
        $.set_discriminant_statement,
        $.place_mention_statement,
        $.assert_statement,
        $.drop_statement,
        $.goto_statement,
        $.switch_statement,
        $.if_statement,
        $.match_statement,
        $.loop_statement,
        $.return_statement,
        $.break_statement,
        $.continue_statement,
        $.nop_statement,
        $.abort_statement,
        $.unwind_statement,
        $.inline_asm_statement,
      ),

    assign_statement: ($) =>
      seq(
        field('lhs', $.place),
        choice(':=', '='),
        field('rhs', $._expression),
        optional($._call_arrow),
        semi(),
      ),

    storage_statement: ($) =>
      seq(
        choice('storage_live', 'storage_dead'),
        choice(seq('(', $.place, ')'), $.place),
        semi(),
      ),

    // A call without a destination (incl. intrinsics like
    // `copy_nonoverlapping(...)`), possibly with a ULLBC terminator arrow.
    call_statement: ($) =>
      seq($.call_expression, optional($._call_arrow), semi()),

    _call_arrow: ($) => seq('->', $.call_target),
    call_target: ($) =>
      seq($.block_id, optional(seq('(', 'unwind', ':', $.block_id, ')'))),

    set_discriminant_statement: ($) =>
      seq($.at_name, '(', $.place, ')', '=', $._expression, semi()),

    place_mention_statement: ($) => seq('_', '=', $.place, semi()),

    // ULLBC: `assert <assert_expr> -> bbN (unwind: bbM)`
    // LLBC:  `<assert_expr> else <abort>`
    assert_statement: ($) =>
      choice(
        seq('assert', $.assert_expr, $._call_arrow, semi()),
        seq($.assert_expr, 'else', $._abort_kind, semi()),
      ),
    assert_expr: ($) =>
      seq(
        'assert',
        '(',
        $._expression,
        ')',
        optional(seq('(', field('check', $.identifier), ')')),
      ),

    drop_statement: ($) =>
      seq(
        choice('drop', 'conditional_drop'),
        optional(seq('[', $._type, ']')),
        $.place,
        optional($._call_arrow),
        semi(),
      ),

    goto_statement: ($) => seq('goto', $.block_id, semi()),

    // ULLBC: `switch op -> v: bbN, ..., otherwise: bbM`
    // LLBC:  `switch op { v | w => { ... }, _ => { ... }, }`
    switch_statement: ($) =>
      seq(
        'switch',
        field('discriminant', $._discriminant),
        choice(
          seq('->', sep1($.switch_target, ',')),
          seq('{', repeat($.switch_arm), '}'),
        ),
        semi(),
      ),
    switch_target: ($) =>
      seq(field('value', choice($._expression, 'otherwise')), ':', $.block_id),
    switch_arm: ($) =>
      seq(
        field('value', sepBar(choice($._expression, '_'))),
        '=>',
        $.brace_block,
        optional(','),
      ),

    // ULLBC: `if op -> bbT else -> bbF`
    // LLBC:  `if op { ... } else { ... }`
    if_statement: ($) =>
      seq(
        'if',
        field('condition', $._discriminant),
        choice(
          seq('->', $.block_id, 'else', '->', $.block_id),
          seq($.brace_block, optional(seq('else', $.brace_block))),
        ),
        semi(),
      ),

    match_statement: ($) =>
      seq('match', field('discriminant', $._discriminant), '{', repeat($.match_arm), '}'),
    match_arm: ($) =>
      seq(
        field('pattern', sepBar(choice($.path, $.integer, '_'))),
        '=>',
        $.brace_block,
        optional(','),
      ),

    loop_statement: ($) => seq('loop', $.brace_block),

    // Restricted form used by `if`/`switch`/`match` so a following `{` is the
    // body, not an aggregate literal.
    _discriminant: ($) => choice($.operand, $.place),

    brace_block: ($) => seq('{', repeat($._statement), '}'),

    return_statement: ($) => seq('return', semi()),
    break_statement: ($) => seq('break', optional($.integer), semi()),
    continue_statement: ($) => seq('continue', optional($.integer), semi()),
    nop_statement: ($) => seq('nop', semi()),

    abort_statement: ($) => seq($._abort_kind, semi()),
    _abort_kind: ($) =>
      choice(
        seq('panic', optional(seq('(', sepComma($._expression), ')'))),
        'undefined_behavior',
        'unwind_terminate',
      ),

    unwind_statement: ($) =>
      seq(choice('unwind_continue', 'unwind_unreachable', 'unreachable'), semi()),

    inline_asm_statement: ($) =>
      seq(
        'asm!',
        '(',
        sepComma($._expression),
        ')',
        optional(seq('->', sep1($.switch_target, ','))),
        optional($.asm_targets),
        semi(),
      ),
    asm_targets: ($) =>
      seq('{', repeat(seq('target', $.integer, '=>', $.brace_block)), '}'),

    // The external scanner / generic `@name` covers `@ERROR(...)` too.
    at_name: ($) => token(/@[A-Za-z_][A-Za-z0-9_]*/),

    // ----- Data type declarations --------------------------------------
    struct_item: ($) =>
      seq(
        optional($.visibility),
        'struct',
        field('name', $.path),
        optional($.where_clause),
        optional($.field_list),
      ),
    union_item: ($) =>
      seq(
        optional($.visibility),
        'union',
        field('name', $.path),
        optional($.where_clause),
        optional($.field_list),
      ),

    field_list: ($) => seq('{', sepComma($.field_declaration), '}'),
    field_declaration: ($) =>
      seq(
        optional(seq(field('name', choice($.identifier, $.integer)), ':')),
        field('type', $._type),
      ),

    enum_item: ($) =>
      seq(
        optional($.visibility),
        'enum',
        field('name', $.path),
        optional($.where_clause),
        optional($.variant_list),
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
        $.proof_clause,
        $.assoc_type,
        $.assoc_const,
        $.method_decl,
        $.vtable_member,
        $.non_dyn_compatible,
        $.function_item,
      ),
    proof_clause: ($) =>
      seq('proof', $._type, ':', $.clause_bound, optional(seq('=', $._type))),
    assoc_type: ($) =>
      seq('type', $.identifier, optional($.generic_arguments), optional(seq('=', $._type)), optional($.where_clause), semi()),
    assoc_const: ($) =>
      seq(
        'const',
        $.identifier,
        optional($.generic_arguments),
        optional(seq(':', $._type)),
        optional(seq('=', $._expression)),
        semi(),
      ),
    method_decl: ($) =>
      seq(
        optional($.visibility),
        optional('unsafe'),
        'fn',
        field('name', $.identifier),
        optional($.generic_arguments),
        choice(';', seq('=', $._type)),
      ),
    vtable_member: ($) => seq('vtable', ':', $._type, semi()),
    non_dyn_compatible: ($) => 'non-dyn-compatible',

    impl_item: ($) =>
      seq(
        optional($.visibility),
        'impl',
        optional($.generic_arguments),
        optional(field('short_name', $.string)),
        field('trait', $._type),
        optional(seq('for', field('type', $._type))),
        optional($.where_clause),
        $.impl_body,
      ),
    impl_body: ($) =>
      seq(
        '{',
        repeat(
          choice(
            $.proof_clause,
            $.assoc_type,
            $.assoc_const,
            $.method_decl,
            $.vtable_member,
            $.non_dyn_compatible,
            $.function_item,
            $.global_item,
            $.type_alias_item,
          ),
        ),
        '}',
      ),

    // ----- Globals / consts / statics ----------------------------------
    global_item: ($) =>
      seq(
        optional($.visibility),
        choice(seq(optional('thread_local'), choice('const', 'static')), 'thread_local'),
        field('name', $.path),
        ':',
        field('type', $._type),
        optional($.where_clause),
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

    // ----- Where clauses ------------------------------------------------
    where_clause: ($) => seq('where', sep1($.where_predicate, ','), optional(',')),
    where_predicate: ($) => seq(optional('proof'), $._type, ':', $._predicate_tail),
    // `(T: Sized)`, `T: 'a`, `Sized + Clone`, `Self::Assoc = ()`
    _predicate_tail: ($) =>
      seq(optional($.for_lifetimes), $._predicate_body, optional(seq('=', $._type))),
    _predicate_body: ($) =>
      choice(
        $.clause_bound,
        seq(
          optional(seq(choice($._type, $.lifetime), ':')),
          sep1(choice($._type, $.lifetime), '+'),
          optional(seq('=', $._type)),
        ),
      ),
    clause_bound: ($) =>
      seq('(', $._type, ':', sep1(choice($._type, $.lifetime), '+'), ')'),

    // ----- Types --------------------------------------------------------
    _type: ($) =>
      choice(
        $.primitive_type,
        $.never_type,
        $.wildcard_type,
        $.unit_type,
        $.tuple_type,
        $.reference_type,
        $.pointer_type,
        $.slice_type,
        $.array_type,
        $.dyn_type,
        $.fn_type,
        $.hrtb_type,
        $.type_error,
        $.refined_type,
        $.clause_typed,
        $.path,
      ),

    primitive_type: ($) => choice(...PRIMITIVE_TYPES),
    never_type: ($) => '!',
    wildcard_type: ($) => '_',
    unit_type: ($) => seq('(', ')'),
    tuple_type: ($) => seq('(', sep1($._type, ','), optional(','), ')'),

    reference_type: ($) =>
      seq('&', optional(choice($.lifetime, '_')), optional('mut'), $._type),
    pointer_type: ($) => seq('*', choice('const', 'mut'), $._type),
    slice_type: ($) => seq('[', $._type, ']'),
    array_type: ($) => seq('[', $._type, ';', $._expression, ']'),
    dyn_type: ($) =>
      prec.right(seq('dyn', sep1(choice($._type, $.lifetime), '+'))),
    hrtb_type: ($) => seq($.for_lifetimes, $._type),
    fn_type: ($) =>
      seq(
        optional('unsafe'),
        optional($.extern_abi),
        'fn',
        optional($.generic_arguments),
        '(',
        sepComma($._type),
        ')',
        optional(seq('->', $._type)),
      ),
    type_error: ($) => seq('type_error', '(', $.string, ')'),
    for_lifetimes: ($) => seq('for', '<', sepComma($.lifetime), '>'),

    // `T[TraitClause0, ...]` — a (nominal) type carrying implicit trait-clause
    // refs.
    clause_typed: ($) =>
      prec.left(seq($.path, '[', sepComma($._type), ']', repeat(seq('::', $.path_segment)))),

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

    // ----- Paths --------------------------------------------------------
    path: ($) =>
      choice(
        seq(optional('::'), sep1($.path_segment, '::')),
        $.qualified_path,
      ),
    qualified_path: ($) =>
      seq('<', $._type, 'as', $._type, '>', repeat(seq('::', $.path_segment))),
    path_segment: ($) =>
      choice(
        prec.dynamic(1, seq($.identifier, repeat1($.generic_arguments))),
        $.identifier,
        repeat1($.generic_arguments),
        seq($.name_group, repeat($.generic_arguments)),
      ),
    // `name_group` (`{closure#0}`, `{built_in impl Destruct for A}`,
    // `{V<T, N>[TraitClause0]}`, ...) is supplied by the external scanner.

    generic_arguments: ($) => seq('<', sepComma($.generic_argument), '>'),
    generic_argument: ($) =>
      choice(
        seq(optional('mut'), $.lifetime),
        $.impl_argument,
        $.const_param,
        $.clause_param,
        $.assoc_binding,
        $._type,
        $.integer,
      ),
    // `Item = bool` inside `dyn Trait<Item = bool>`.
    assoc_binding: ($) => seq($.path, '=', $._type),
    impl_argument: ($) =>
      seq('impl', $._type, optional(seq('for', $._type))),
    const_param: ($) => seq('const', $.identifier, ':', $._type),
    // Inline trait-clause parameter inside a binder's generics, e.g.
    // `<H, TraitClause0: (H: Sized)>`.
    clause_param: ($) => seq($.identifier, ':', $._predicate_tail),

    lifetime: ($) => token(seq("'", choice('_', /[A-Za-z_][A-Za-z0-9_]*/, /\d+/))),

    // ----- Expressions / rvalues / operands -----------------------------
    _expression: ($) =>
      choice(
        $.operand,
        $.borrow,
        $.cast_expression,
        $.nullary_op,
        $.offset_of,
        $.builtin_call,
        $.unary_expression,
        $.binary_expression,
        $.aggregate,
        $.raw_pointer_aggregate,
        $.array_expression,
        $.repeat_expression,
        $.tuple_expression,
        $.call_expression,
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
        $.call_expression,
        $.clause_typed,
        $.no_provenance,
        $.opaque_const,
        $.path,
      ),
    // `Opaque(reason)` carries free-form text.
    opaque_const: ($) => token(seq('Opaque(', /[^)]*/, ')')),
    no_provenance: ($) => seq('no-provenance', $.integer),

    // Char constants pretty-printed as a bare glyph (rare; mostly superseded by
    // quoted `char` literals). Reachable only where a constant is expected.
    raw_char: ($) => token(prec(-2, /[^\s]/)),

    borrow: ($) =>
      seq(
        $.borrow_kind,
        // Usually a place; in constants also an array or a `vtable_of(...)` /
        // similar call, e.g. `const &vtable_of({built_in impl ... })`.
        choice($.place, $.array_expression, $.call_expression),
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
        sepComma(choice($._type, $.integer, $.cast_metadata, $.borrow, '?')),
        '>',
        optional(seq('[', sepComma($._type), ']')),
        '(',
        $._expression,
        ')',
      ),
    cast_metadata: ($) => seq('at', '[', sepComma($._expression), ']'),

    // `ub_checks<bool>`, `overflow_checks<>` — a nullary operation written as a
    // bare turbofish with no call parentheses.
    nullary_op: ($) =>
      seq(
        choice('ub_checks', 'overflow_checks', 'contract_checks'),
        '<',
        sepComma(choice($._type, $.integer)),
        '>',
      ),

    // `offset_of(Struct<T>[TraitClause0].b)<usize>`
    offset_of: ($) =>
      seq(
        'offset_of',
        '(',
        $._type,
        '.',
        field('field', choice($.identifier, $.integer)),
        ')',
        '<',
        sepComma($._type),
        '>',
      ),

    // `@discriminant(p)`, `@SliceIndexShared<'_, u8>(move _1, copy _2)`, ...
    builtin_call: ($) =>
      seq(
        $.at_name,
        optional($.generic_arguments),
        optional(seq('[', sepComma($._type), ']')),
        '(',
        sepComma($._expression),
        ')',
      ),

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

    aggregate: ($) =>
      prec(2, seq(field('type', $.path), '{', sepComma($.field_initializer), '}')),
    field_initializer: ($) =>
      seq(field('name', choice($.identifier, $.integer)), ':', field('value', $._expression)),

    raw_pointer_aggregate: ($) =>
      seq('*', choice('const', 'mut'), '(', sepComma($._expression), ')'),

    array_expression: ($) => seq('[', sepComma($._expression), ']'),
    repeat_expression: ($) => seq('[', $._expression, ';', $._expression, ']'),
    tuple_expression: ($) => seq('(', sep1($._expression, ','), optional(','), ')'),
    unit_expression: ($) => seq('(', ')'),

    call_expression: ($) =>
      seq(
        field('function', choice($.path, $.clause_typed, seq('(', $._expression, ')'))),
        '(',
        sepComma($._expression),
        ')',
      ),

    // ----- Places -------------------------------------------------------
    place: ($) =>
      prec.left(seq($._place_atom, repeat($._place_projection))),
    _place_atom: ($) =>
      choice(
        $.path,
        $.clause_typed,
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
    // `place[i]`, `place[i..j]`, `place[i..]`, `place[-1]`
    index_projection: ($) =>
      seq('[', choice(seq($._expression, '..', optional($._expression)), $._expression), ']'),

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
      token(
        seq(
          optional('-'),
          choice(
            seq(/[0-9]+\.[0-9]+/, optional(/f(16|32|64|128)/)),
            seq(/[0-9]+/, /f(16|32|64|128)/),
          ),
        ),
      ),

    string: ($) => token(seq('"', repeat(choice(/[^"\\]/, /\\./)), '"')),
    byte_string: ($) => token(seq('b"', repeat(choice(/[^"\\]/, /\\./)), '"')),
    char: ($) =>
      token(
        seq(
          "'",
          choice(/[^'\\]/, /\\u\{[0-9a-fA-F]+\}/, /\\x[0-9a-fA-F]{2}/, /\\./),
          "'",
        ),
      ),

    identifier: ($) => /[A-Za-z_][A-Za-z0-9_]*(#[0-9]+)?/,
  },
});
