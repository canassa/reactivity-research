// The dashboard scenario written in beni: one source for both of beni's browser platforms
// (browser-tea and browser-direct; browser-direct's `Tea` is "the API of browser-tea's Tea, so
// one source builds on both"). The two emitters (scenarios/dashboard/beni-tea.js and
// beni-direct.js) call `emitDashboard` with their own framework's template files. It lives in
// the scenario's shared folder, which every measurement's inputs hash covers.
//
// Style (recorded in every generated app's rr.json), following beni's README, its getting-started
// guide and its Conduit example (elm-spa-example's structure, in beni):
// - The Elm Architecture with `Tea.element`, mounted with `Browser.mountAt` at the page's root:
//   one `Model` record holding every widget's state (one field per widget), one `update`, one
//   `view` written as markup. Summaries keep no state: their line is computed from the model in
//   `view`, with string interpolation.
// - Shared components: each widget kind is written once, as one module (`Widget.Counter`,
//   `Widget.Todo`, …) with its `Config` (what varies per instance: label, texts, limits, items,
//   rules), `Model`, `Msg`, `update`, `view` and `replace` (its state, read from a host value).
//   Nothing is generated per instance but data: `Main` holds one `Config` value per widget, one
//   `Model` field of its kind's type and one `Msg` constructor wrapping its kind's `Msg`, routed by
//   one-line branches in `update` and `Html.map` in `view`.
// - Per-instance rules are small helpers of their kind's module, partly applied with `_`:
//   `Field.required`/`minLength`/`matching` (beni has no regular expressions, so a pattern rule is
//   a character predicate) and `Amount.currency`/`percent`/`unit`.
// - Markup: keyed `<For keyed={.id}>` for todo, filter and feed items; positional
//   `<For keyed={False}>` for toggles and tabs; conditional content as a `case`/`if` hole whose
//   other branch is the empty fragment; `onClick`, and `onInput` for text inputs and the select.
//   Inputs are controlled, as beni's are: the amount widget keeps the text typed next to its last
//   valid number, so an input that holds no number keeps what the user typed.
// - External events arrive through the project's platform layer (`Push.onPush Pushed`, a
//   subscription; beni has no ports, frameworks/beni/template/Push.beni) as host values. `update`
//   reads one with a `schema` declaration (`Event`, tagged on "type") and hands the widget it names
//   its new state, which the widget reads with a derived codec (`Json.decodeValue` at its `Model`
//   type). A list read from the host is copied (`List.copy`) where the model takes it, as beni's
//   ownership checker asks (browser-direct edits lists in place); decoding in `update`, rather than
//   in the subscription's function, is also what that checker accepts.
// - Production build: `beni build --release --source-maps` (frameworks/beni/beni.js).

import { camelCase } from "../../../frameworks/shared/jsx.js";

const MODULE = {
  counter: "Counter", toggles: "Toggles", field: "Field", todo: "Todo", tabs: "Tabs", panel: "Panel",
  choice: "Choice", amount: "Amount", filter: "Filter", rating: "Rating", feed: "Feed", clock: "Clock",
  summary: "Summary",
};

export const STYLE = {
  architecture: "The Elm Architecture: Tea.element, one Model record, one update, one view (markup)",
  components: "one module per widget kind (Config, Model, Msg, update, view, replace); Main holds per-widget Config data",
  routing: "one Msg constructor per widget wrapping its kind's Msg, plus Pushed for host events; Html.map in view",
  lists: "keyed For (.id) for todo, filter, feed; positional For for toggles, tabs",
  conditional: "case/if holes with an empty fragment",
  derived: "computed in view (summary lines with interpolation, todo left, filter matches)",
  externalEvents: "project platform layer Push.onPush (Sub.on over a window event), read with a schema declaration and derived codecs",
  inputs: "controlled inputs; amount keeps its typed text beside its last valid number",
  build: "beni build --release --source-maps (beni's own minifier)",
};

// ---------------------------------------------------------------------------------------------
// beni literals

export function beniString(s) {
  return '"' + String(s).replace(/[\\"\n\r\t]|\$\{/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t", "${": "\\${" })[c]) + '"';
}

// A beni expression for plain data (records, lists, strings, numbers, booleans), on one line when
// short, else one item per line with leading commas, as `beni fmt` lays it out.
export function beniValue(value, indent = "") {
  if (typeof value === "string") return beniString(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (value && value.raw) return value.raw;
  const inner = indent + "    ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const flat = `[ ${value.map((v) => beniValue(v, inner)).join(", ")} ]`;
    if (flat.length + indent.length <= 100 && !flat.includes("\n")) return flat;
    const items = value.map((v) => beniValue(v, indent + "  "));
    return `[ ${items.join(`\n${indent}, `)}\n${indent}]`;
  }
  const entries = Object.entries(value);
  const flat = `{ ${entries.map(([k, v]) => `${k} = ${beniValue(v, inner)}`).join(", ")} }`;
  if (flat.length + indent.length <= 100 && !flat.includes("\n")) return flat;
  const lines = entries.map(([k, v]) => {
    const one = beniValue(v, indent + "  ");
    if (!one.includes("\n") && indent.length + k.length + one.length + 5 <= 100) return `${k} = ${one}`;
    return `${k} =\n${indent}    ${beniValue(v, indent + "    ")}`;
  });
  return `{ ${lines.join(`\n${indent}, `)}\n${indent}}`;
}

const raw = (text) => ({ raw: text });

// ---------------------------------------------------------------------------------------------
// The widget kinds: one module each, written once

// Each module opens with a doc comment saying what the widget is.
const KIND_MODULES = {
  counter: () => `--! A counter: a number stepped up and down between two limits.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    step : Int
    min : Int
    max : Int
    start : Int


pub type alias Model =
    value : Int


pub type Msg
    = Increment
    | Decrement
    | Reset


pub update : Config, Msg, Model → Model
update config msg model =
    case msg of
        Increment →
            { model | value = min config.max (model.value + config.step) }

        Decrement →
            { model | value = max config.min (model.value - config.step) }

        Reset →
            { model | value = config.start }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-counter">
        <h2>{config.label}</h2>
        <output data-role="value">{model.value}</output>
        <button data-role="dec" disabled={model.value ≤ config.min} onClick={Decrement}>
            -{config.step}
        </button>
        <button data-role="inc" disabled={model.value ≥ config.max} onClick={Increment}>
            +{config.step}
        </button>
        <button data-role="reset" onClick={Reset}>Reset</button>
    </section>
`,

  toggles: () => `--! A set of switches, each with its label, and how many are on.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    items : List String


pub type alias Model =
    on : List Bool


pub type Msg
    = Toggle Int


pub update : Msg, Model → Model
update msg model =
    case msg of
        Toggle index →
            { model | on = List.update model.on index not }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model =
    case Json.decodeValue state of
        Ok new →
            { on = List.copy new.on }

        Err _ →
            model


pub count : Model → Int
count model = List.length (List.filter model.on identity)


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-toggles">
        <h2>{config.label}</h2>
        <ul>
            <For each={List.map2 config.items model.on λname isOn → ( name, isOn )} keyed={False}>
                {λ( name, isOn ) index →
                    <li>
                        <label>
                            <input
                                type="checkbox"
                                data-role="toggle"
                                data-key={String.fromInt index}
                                checked={isOn}
                                onClick={Toggle index}
                            />
                            {name}
                        </label>
                    </li>
                }
            </For>
        </ul>
        <p data-role="count">{count model} of {List.length config.items} on</p>
    </section>
`,

  field: (app) => `--! A text field with a rule, and the rule's message while the text breaks it.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    placeholder : String
    validate : String → Maybe String


pub type alias Model =
    text : String


pub type Msg
    = Edited String


pub update : Msg, Model → Model
update msg model =
    case msg of
        Edited typed →
            { model | text = typed }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-field">
        <h2>{config.label}</h2>
        <input
            type="text"
            data-role="input"
            placeholder={config.placeholder}
            value={model.text}
            onInput={Edited}
        />
        {case config.validate model.text of
            Just message →
                <p data-role="error">{message}</p>

            Nothing →
                <></>
        }
    </section>


-- ---- Rules ---------------------------------------------------------------------
${fieldRules(app)}`,

  todo: () => `--! A to-do list: a draft to add, items to check off and remove, and how many are left.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    placeholder : String
    addText : String
    removeText : String


pub type alias Item =
    id : Int
    text : String
    done : Bool


pub type alias Model =
    items : List Item
    draft : String


pub type Msg
    = DraftEdited String
    | Add
    | Toggle Int
    | Remove Int


pub update : Msg, Model → Model
update msg model =
    case msg of
        DraftEdited draft →
            { model | draft = draft }

        Add →
            trimmed = String.trim model.draft
            if String.isEmpty trimmed then
                model
            else
                nextId = 1 + List.foldl model.items 0 λitem highest → max item.id highest
                { items = [ …model.items, { id = nextId, text = trimmed, done = False } ]
                , draft = ""
                }

        Toggle id →
            { model
                | items =
                    List.map model.items λitem →
                        if item.id == id then { item | done = not item.done } else item
            }

        Remove id →
            { model | items = List.filter model.items λitem → item.id ≠ id }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model =
    case Json.decodeValue state of
        Ok new →
            { items = List.copy new.items, draft = new.draft }

        Err _ →
            model


pub left : Model → Int
left model = List.length (List.filter model.items λitem → not item.done)


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-todo">
        <h2>{config.label}</h2>
        <input
            type="text"
            data-role="draft"
            placeholder={config.placeholder}
            value={model.draft}
            onInput={DraftEdited}
        />
        <button data-role="add" onClick={Add}>{config.addText}</button>
        <ul>
            <For each={model.items} keyed={.id}>
                {λitem →
                    <li data-key={String.fromInt item.id}>
                        <input
                            type="checkbox"
                            data-role="toggle"
                            checked={item.done}
                            onClick={Toggle item.id}
                        />
                        <span>{item.text}</span>
                        <button data-role="remove" onClick={Remove item.id}>
                            {config.removeText}
                        </button>
                    </li>
                }
            </For>
        </ul>
        <p data-role="left">{left model} left</p>
    </section>
`,

  tabs: () => `--! Tabs: one button per tab, and the content of the one selected.

import Html exposing (Html)
import Json
import Schema exposing (Value)
import Ui


pub type alias Tab =
    title : String
    content : String


pub type alias Config =
    id : String
    label : String
    tabs : List Tab


pub type alias Model =
    active : Int


pub type Msg
    = Select Int


pub update : Msg, Model → Model
update msg model =
    case msg of
        Select index →
            { model | active = index }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-tabs">
        <h2>{config.label}</h2>
        <div role="tablist">
            <For each={config.tabs} keyed={False}>
                {λtab index →
                    <button
                        role="tab"
                        data-role="tab"
                        data-key={String.fromInt index}
                        aria-selected={Ui.flag (index == model.active)}
                        onClick={Select index}
                    >
                        {tab.title}
                    </button>
                }
            </For>
        </div>
        <p role="tabpanel" data-role="tab-content">{content config model}</p>
    </section>


content : Config, Model → String
content config model =
    case List.get config.tabs model.active of
        Just tab →
            tab.content

        Nothing →
            ""
`,

  panel: () => `--! A panel: a button that shows and hides its body.

import Html exposing (Html)
import Json
import Schema exposing (Value)
import Ui


pub type alias Config =
    id : String
    label : String
    showText : String
    hideText : String
    body : String


pub type alias Model =
    open : Bool


pub type Msg
    = Toggle


pub update : Msg, Model → Model
update msg model =
    case msg of
        Toggle →
            { model | open = not model.open }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-panel">
        <h2>{config.label}</h2>
        <button data-role="toggle" aria-expanded={Ui.flag model.open} onClick={Toggle}>
            {if model.open then config.hideText else config.showText}
        </button>
        {if model.open then <p data-role="body">{config.body}</p> else <></>}
    </section>
`,

  choice: () => `--! A choice among options, with a text input that some options ask for.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Option =
    value : String
    label : String


pub type alias Config =
    id : String
    label : String
    options : List Option
    extraFor : List String
    extraPlaceholder : String


pub type alias Model =
    option : String
    extra : String


pub type Msg
    = Chose String
    | ExtraEdited String


pub update : Msg, Model → Model
update msg model =
    case msg of
        Chose option →
            { model | option = option }

        ExtraEdited extra →
            { model | extra = extra }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-choice">
        <h2>{config.label}</h2>
        <select data-role="select" value={model.option} onInput={Chose}>
            <For each={config.options} keyed={.value}>
                {λoption → <option value={option.value}>{option.label}</option>}
            </For>
        </select>
        {if List.member config.extraFor model.option then
            <input
                type="text"
                data-role="extra"
                placeholder={config.extraPlaceholder}
                value={model.extra}
                onInput={ExtraEdited}
            />
         else
            <></>
        }
    </section>
`,

  amount: (app) => `--! An amount: a number input, and the number formatted.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    format : Float → String


--| The last valid number, and the text the input holds: the input is
--| controlled, so while it holds no number (empty, a lone "-") it shows
--| what the user typed, and the number stays as it was.
pub type alias Model =
    value : Float
    text : String


pub type Msg
    = Typed String


pub init : Float → Model
init amount = { value = amount, text = decimal amount }


--| The number as the input writes it: a whole number without a ".0".
pub decimal : Float → String
decimal amount =
    whole = round amount
    if toFloat whole == amount then String.fromInt whole else String.fromFloat amount


pub update : Msg, Model → Model
update msg model =
    case msg of
        Typed typed →
            case String.toFloat typed of
                Just amount →
                    { value = amount, text = typed }

                Nothing →
                    { model | text = typed }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model =
    case Json.decodeValue state of
        Ok new →
            init new.value

        Err _ →
            model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-amount">
        <h2>{config.label}</h2>
        <input type="number" data-role="input" value={model.text} onInput={Typed} />
        <output data-role="formatted">{config.format model.value}</output>
    </section>


-- ---- Formats -------------------------------------------------------------------
${amountFormats(app)}
-- The amount with exactly \`decimals\` digits after the point.
fixed : Int, Float → String
fixed decimals amount =
    digits =
        String.padLeft
            (String.fromInt (round (abs amount * toFloat (10 ^ decimals))))
            (decimals + 1)
            '0'
    sign = if amount < 0 then "-" else ""
    if decimals == 0 then
        sign ++ digits
    else
        "\${sign}\${String.dropRight digits decimals}.\${String.right digits decimals}"
`,

  filter: () => `--! A filtered list: a query, the items whose text contains it, and how many.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Item =
    id : Int
    text : String


pub type alias Config =
    id : String
    label : String
    items : List Item
    placeholder : String


pub type alias Model =
    query : String


pub type Msg
    = Edited String


pub update : Msg, Model → Model
update msg model =
    case msg of
        Edited query →
            { model | query = query }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


--| The items whose text contains the query, ignoring case.
pub matches : List Item, String → List Item
matches items query =
    wanted = String.toLower query
    List.filter items λitem → String.contains (String.toLower item.text) wanted


pub view : Config, Model → Html Msg
view config model =
    shown = matches config.items model.query
    <section data-key={config.id} data-role="widget-filter">
        <h2>{config.label}</h2>
        <input
            type="text"
            data-role="query"
            placeholder={config.placeholder}
            value={model.query}
            onInput={Edited}
        />
        <ul>
            <For each={shown} keyed={.id}>
                {λitem → <li data-key={String.fromInt item.id}>{item.text}</li>}
            </For>
        </ul>
        <p data-role="matches">{List.length shown} matches</p>
    </section>
`,

  rating: () => `--! A rating: one button per star, and the word for the rating given.

import Html exposing (Html)
import Json
import Schema exposing (Value)
import Ui


pub type alias Config =
    id : String
    label : String
    stars : Int
    labels : List String


pub type alias Model =
    stars : Int


pub type Msg
    = Rate Int


pub update : Msg, Model → Model
update msg model =
    case msg of
        Rate stars →
            { model | stars = stars }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-rating">
        <h2>{config.label}</h2>
        <div>
            <For each={List.range 1 config.stars}>
                {λstar →
                    <button
                        data-role="star"
                        data-key={String.fromInt star}
                        aria-pressed={Ui.flag (star ≤ model.stars)}
                        onClick={Rate star}
                    >
                        {if star ≤ model.stars then "★" else "☆"}
                    </button>
                }
            </For>
        </div>
        <p data-role="rating-label">{Maybe.withDefault (List.get config.labels model.stars) ""}</p>
    </section>
`,

  feed: () => `--! A feed: entries the host pushes, each dismissed by the user.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    emptyText : String
    dismissText : String


pub type alias Entry =
    id : Int
    text : String


pub type alias Model =
    entries : List Entry


pub type Msg
    = Dismiss Int


pub update : Msg, Model → Model
update msg model =
    case msg of
        Dismiss id →
            { model | entries = List.filter model.entries λentry → entry.id ≠ id }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model =
    case Json.decodeValue state of
        Ok new →
            { entries = List.copy new.entries }

        Err _ →
            model


--| The entry the host sent, last; or the model as it was when it sent none.
pub notify : Value, Model → Model
notify entry model =
    case Json.decodeValue entry of
        Ok new →
            { model | entries = [ …model.entries, new ] }

        Err _ →
            model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-feed">
        <h2>{config.label}</h2>
        <ul>
            <For each={model.entries} keyed={.id}>
                {λentry →
                    <li data-key={String.fromInt entry.id}>
                        <span>{entry.text}</span>
                        <button data-role="dismiss" onClick={Dismiss entry.id}>
                            {config.dismissText}
                        </button>
                    </li>
                }
            </For>
        </ul>
        {if List.isEmpty model.entries then <p data-role="empty">{config.emptyText}</p> else <></>}
    </section>
`,

  clock: () => `--! A clock: seconds that advance on the host's ticks while it runs.

import Html exposing (Html)
import Json
import Schema exposing (Value)


pub type alias Config =
    id : String
    label : String
    startText : String
    stopText : String
    resetText : String


pub type alias Model =
    seconds : Int
    running : Bool


pub type Msg
    = Start
    | Stop
    | Reset


pub update : Msg, Model → Model
update msg model =
    case msg of
        Start →
            { model | running = True }

        Stop →
            { model | running = False }

        Reset →
            { seconds = 0, running = False }


--| The state the host sent, or the model as it was when it sent none.
pub replace : Value, Model → Model
replace state model = Result.withDefault (Json.decodeValue state) model


--| One second more, while it runs.
pub tick : Model → Model
tick model = if model.running then { model | seconds = model.seconds + 1 } else model


pub view : Config, Model → Html Msg
view config model =
    <section data-key={config.id} data-role="widget-clock">
        <h2>{config.label}</h2>
        <output data-role="time">{time model.seconds}</output>
        <button data-role="start" disabled={model.running} onClick={Start}>
            {config.startText}
        </button>
        <button data-role="stop" disabled={not model.running} onClick={Stop}>
            {config.stopText}
        </button>
        <button data-role="reset" onClick={Reset}>{config.resetText}</button>
    </section>


-- Minutes and seconds, \`m:ss\`.
time : Int → String
time seconds = "\${seconds // 60}:\${String.padLeft (String.fromInt (Int.mod seconds 60)) 2 '0'}"
`,

  summary: () => `--! A summary: a line computed from other widgets, with no state of its own.

import Html exposing (Html)


pub type alias Config =
    id : String
    label : String


pub view : Config, String → Html msg
view config line =
    <section data-key={config.id} data-role="widget-summary">
        <h2>{config.label}</h2>
        <p data-role="summary">{line}</p>
    </section>
`,
};

const UI_MODULE = `--! What several widgets' views share.

--| An ARIA state's value: "true" or "false".
pub flag : Bool → String
flag on = if on then "true" else "false"
`;

// Field rules: the three constructors of a rule, and the predicates the app's pattern rules use.
// beni has no regular expressions, so each pattern of the spec is a character predicate.
const PATTERNS = {
  "^[0-9]+$": { name: "digitsOnly", doc: "Digits only, at least one.", body: "digitsOnly text = not (String.isEmpty text) && String.all text Char.isDigit" },
  "^[a-z]+$": { name: "lowercaseOnly", doc: "Lowercase letters a to z only, at least one.", body: "lowercaseOnly text = not (String.isEmpty text) && String.all text λc → c ≥ 'a' && c ≤ 'z'" },
  "^[A-Z]": { name: "capitalized", doc: "Starts with a capital letter A to Z.", body: "capitalized text =\n    case String.uncons text of\n        Just ( first, _ ) →\n            first ≥ 'A' && first ≤ 'Z'\n\n        Nothing →\n            False" },
  "@": { name: "hasAt", doc: "Contains an @.", body: "hasAt text = String.contains text \"@\"" },
  "^\\S+$": { name: "noSpaces", doc: "At least one character, and no white space.", body: "noSpaces text =\n    not (String.isEmpty text)\n        && not (String.any text λc → c == ' ' || c == '\\t' || c == '\\n' || c == '\\r')" },
};

function patternOf(rule) {
  const p = PATTERNS[rule.pattern];
  if (!p) throw new Error(`beni emitter: no predicate for the field pattern ${rule.pattern}`);
  return p;
}

function fieldRules(app) {
  const rules = app.widgets.filter((w) => w.kind === "field").map((w) => w.rule);
  const types = new Set(rules.map((r) => r.type));
  const out = [];
  if (types.has("required")) out.push(`--| Required: the message while the text is blank.
pub required : String, String → Maybe String
required message text = if String.isEmpty (String.trim text) then Just message else Nothing`);
  if (types.has("minLength")) out.push(`--| The message while the text is shorter than \`least\` characters.
pub minLength : Int, String, String → Maybe String
minLength least message text = if String.length text < least then Just message else Nothing`);
  if (types.has("pattern")) {
    out.push(`--| The message while the text fails the test.
pub matching : (String → Bool), String, String → Maybe String
matching test message text = if test text then Nothing else Just message`);
    const used = [...new Set(rules.filter((r) => r.type === "pattern").map((r) => r.pattern))].sort();
    for (const pattern of used) {
      const p = patternOf({ pattern });
      out.push(`--| ${p.doc}\npub ${p.name} : String → Bool\n${p.body}`);
    }
  }
  return "\n\n" + out.join("\n\n\n") + "\n";
}

function amountFormats(app) {
  const types = new Set(app.widgets.filter((w) => w.kind === "amount").map((w) => w.format.type));
  const out = [];
  if (types.has("currency")) out.push(`pub currency : String, Int, Float → String
currency symbol decimals amount = symbol ++ fixed decimals amount`);
  if (types.has("percent")) out.push(`pub percent : Int, Float → String
percent decimals amount = fixed decimals amount ++ "%"`);
  if (types.has("unit")) out.push(`pub unit : String, Int, Float → String
unit name decimals amount = "\${fixed decimals amount} \${name}"`);
  return "\n\n" + out.join("\n\n\n") + "\n\n";
}

// ---------------------------------------------------------------------------------------------
// Main

// The per-instance configuration of a widget, as plain data for a beni record.
function configOf(w) {
  const base = { id: w.id, label: w.label };
  switch (w.kind) {
    case "counter": return { ...base, step: w.step, min: w.min, max: w.max, start: w.start };
    case "toggles": return { ...base, items: w.items };
    case "field": return { ...base, placeholder: w.placeholder, validate: raw(validateExpr(w.rule)) };
    case "todo": return { ...base, placeholder: w.placeholder, addText: w.addText, removeText: w.removeText };
    case "tabs": return { ...base, tabs: w.tabs };
    case "panel": return { ...base, showText: w.showText, hideText: w.hideText, body: w.body };
    case "choice": return { ...base, options: w.options, extraFor: w.extraFor, extraPlaceholder: w.extraPlaceholder };
    case "amount": return { ...base, format: raw(formatExpr(w.format)) };
    case "filter": return { ...base, items: w.items, placeholder: w.placeholder };
    case "rating": return { ...base, stars: w.stars, labels: w.labels };
    case "feed": return { ...base, emptyText: w.emptyText, dismissText: w.dismissText };
    case "clock": return { ...base, startText: w.startText, stopText: w.stopText, resetText: w.resetText };
    case "summary": return base;
  }
  throw new Error(`no config for ${w.kind}`);
}

function validateExpr(rule) {
  const msg = beniString(rule.message);
  if (rule.type === "required") return `Field.required ${msg} _`;
  if (rule.type === "minLength") return `Field.minLength ${rule.min} ${msg} _`;
  return `Field.matching Field.${patternOf(rule).name} ${msg} _`;
}

function formatExpr(f) {
  if (f.type === "currency") return `Amount.currency ${beniString(f.symbol)} ${f.decimals} _`;
  if (f.type === "percent") return `Amount.percent ${f.decimals} _`;
  return `Amount.unit ${beniString(f.unit)} ${f.decimals} _`;
}

// A widget's initial model, as a beni expression.
function initialOf(w, s) {
  if (w.kind === "amount") return raw(`Amount.init ${s.value}`);
  return s;
}

// Names: a widget's config value, model field and message constructor are named after its
// label (labels are unique), as a person naming them would.
function namer(spec) {
  const used = new Set(["main", "init", "update", "step", "view", "subscriptions", "pushed", "replaced",
    "notified", "formatNumber", "model", "msg", "widgets", "event"]);
  const unique = (base) => {
    let n = base;
    for (let k = 2; used.has(n) || used.has(n[0].toLowerCase() + n.slice(1)); k++) n = base + k;
    used.add(n[0].toLowerCase() + n.slice(1));
    return n;
  };
  const names = {};
  for (const w of spec.widgets) {
    const value = unique(camelCase(w.label));
    names[w.id] = { value, ctor: value[0].toUpperCase() + value.slice(1) };
  }
  for (const w of spec.widgets) {
    if (w.kind === "summary") names[w.id].line = unique(names[w.id].value + "Line");
  }
  return names;
}

// The number a summary reads from a widget: [beni expression, its type].
function metric(src, n) {
  const field = `model.${n.value}`;
  switch (src.kind) {
    case "counter": return [`${field}.value`, "Int"];
    case "amount": return [`${field}.value`, "Float"];
    case "toggles": return [`Toggles.count ${field}`, "Int"];
    case "todo": return [`Todo.left ${field}`, "Int"];
    case "rating": return [`${field}.stars`, "Int"];
    case "clock": return [`${field}.seconds`, "Int"];
    case "filter": return [`List.length (Filter.matches ${n.value}.items ${field}.query)`, "Int"];
    case "feed": return [`List.length ${field}.entries`, "Int"];
  }
  throw new Error(`a summary cannot read ${src.kind}`);
}

const METRIC_SUFFIX = {
  counter: "Value", amount: "Value", toggles: "On", todo: "Left", rating: "Stars", clock: "Seconds", filter: "Found", feed: "Entries",
};

const PHRASE = {
  counter: (v, w) => [`${w.label}: `, v],
  amount: (v, w) => [`${w.label}: `, v],
  toggles: (v, w) => [v, ` on in ${w.label}`],
  todo: (v, w) => [v, ` left in ${w.label}`],
  rating: (v, w) => [v, ` stars for ${w.label}`],
  clock: (v, w) => [v, `s on ${w.label}`],
  filter: (v, w) => [v, ` found in ${w.label}`],
  feed: (v, w) => [v, ` in ${w.label}`],
};

// Text inside a beni string, around interpolations.
const chunk = (s) => beniString(s).slice(1, -1);

// A function computing a summary's line from the model.
function summaryFunction(spec, w, names) {
  const sources = w.sources.map((id) => spec.widgets.find((x) => x.id === id));
  const used = new Set();
  const bindings = sources.map((src) => {
    let name = names[src.id].value + METRIC_SUFFIX[src.kind];
    while (used.has(name)) name += "2";
    used.add(name);
    const [expr, type] = metric(src, names[src.id]);
    return { name, expr, type };
  });
  const decimal = bindings.some((b) => b.type === "Float");
  const show = (b) => (b.type === "Float" ? `formatNumber ${b.name}` : b.name);
  const sum = bindings.map((b) => (decimal && b.type === "Int" ? `toFloat ${b.name}` : b.name)).join(" + ");
  const total = decimal ? `formatNumber (${sum})` : sum;
  let parts;
  if (w.formula === "sum") parts = [`${w.prefix}: `, { e: total }];
  else if (w.formula === "breakdown") {
    parts = [`${w.prefix}: `];
    bindings.forEach((b, i) => parts.push(...(i ? [" + "] : []), { e: show(b) }));
    parts.push(" = ", { e: total });
  } else {
    parts = [];
    sources.forEach((src, i) => {
      if (i) parts.push("; ");
      parts.push(...PHRASE[src.kind]({ e: show(bindings[i]) }, src));
    });
  }
  const line = '"' + parts.map((p) => (typeof p === "string" ? chunk(p) : `\${${p.e}}`)).join("") + '"';
  const n = names[w.id];
  return `${n.line} : Model → String
${n.line} model =
${bindings.map((b) => (`    ${b.name} = ${b.expr}`.length <= 100 ? `    ${b.name} = ${b.expr}` : `    ${b.name} =\n        ${b.expr}`)).join("\n")}
    ${line}`;
}

function needsFormatNumber(spec) {
  return spec.widgets.some((w) => w.kind === "summary" && w.sources.some((id) => spec.widgets.find((x) => x.id === id).kind === "amount"));
}

// `name = value`, on one line when it fits, else the value on the lines below.
function definition(name, value) {
  const one = beniValue(value, "");
  if (!one.includes("\n") && name.length + one.length + 3 <= 100) return `${name} = ${one}`;
  return `${name} =\n    ${beniValue(value, "    ")}`;
}

function mainModule(spec) {
  const names = namer(spec);
  const widgets = spec.widgets;
  const stateful = widgets.filter((w) => w.kind !== "summary");
  const kinds = [...new Set(widgets.map((w) => w.kind))].sort((a, b) => MODULE[a].localeCompare(MODULE[b]));
  const clocks = stateful.filter((w) => w.kind === "clock");
  const feeds = stateful.filter((w) => w.kind === "feed");
  const n = (w) => names[w.id];
  const out = [];

  const imports = [
    "import Browser",
    "import Cmd exposing (Cmd)",
    "import Html exposing (Html)",
    "import Push",
    "import Schema exposing (Value)",
    "import Sub exposing (Sub)",
    "import Tea",
    ...kinds.map((k) => `import Widget.${MODULE[k]} as ${MODULE[k]}`),
  ];
  out.push(`--! The dashboard: ${widgets.length} widget${widgets.length === 1 ? "" : "s"}, each written by its kind's module (\`Widget.*\`) and
--! configured here, in The Elm Architecture: one model holding every widget's state,
--! one update that hands each widget its own messages, and one view.

${imports.join("\n")}


main : Tea.Program
main =
    Browser.mountAt
        (Tea.element { init = init, update = update, view = view, subscriptions = subscriptions })
        "root"`);

  // Model
  out.push(`-- ---- Model ---------------------------------------------------------------------


type alias Model =
${stateful.map((w) => `    ${n(w).value} : ${MODULE[w.kind]}.Model`).join("\n")}`);

  const initial = Object.fromEntries(stateful.map((w) => [n(w).value, initialOf(w, spec.initialState.widgets[w.id])]));
  out.push(`init : ⊤ → Model × Cmd Msg
init ⊤ =
    ( ${beniValue(initial, "      ")}
    , Cmd.none
    )`);

  // Widgets
  out.push(`-- ---- Widgets -------------------------------------------------------------------`);
  for (const w of widgets) {
    out.push(`${n(w).value} : ${MODULE[w.kind]}.Config\n${definition(n(w).value, configOf(w))}`);
  }

  // Update
  // A record field `name = expr` after `lead` ("{ ", "| ", ", ") at `indent`: the expression
  // on the next line when the line would pass 100 columns.
  const field = (lead, [name, expr], indent) => {
    const one = `${lead}${name} = ${expr}`;
    if (indent.length + one.length <= 100) return one;
    return `${lead}${name} =\n${indent}    ${expr}`;
  };
  // A record update, `{ model | field = expr }`, on one line when it fits at `indent`.
  const set = (fields, indent) => {
    const flat = `{ model | ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} }`;
    if (flat.length + indent.length <= 100) return flat;
    const lines = fields.map((fv, i) => field(i ? ", " : "| ", fv, indent + "    "));
    return `{ model\n${indent}    ${lines.join(`\n${indent}    `)}\n${indent}}`;
  };
  // A record literal over several lines at `indent`.
  const record = (fields, indent) =>
    `${fields.map((fv, i) => field(i ? ", " : "{ ", fv, indent)).join(`\n${indent}`)}\n${indent}}`;
  const arms = stateful.map((w) => {
    const takesConfig = w.kind === "counter";
    const call = `${MODULE[w.kind]}.update ${takesConfig ? n(w).value + " " : ""}widgetMsg model.${n(w).value}`;
    return `        ${n(w).ctor} widgetMsg →\n            ${set([[n(w).value, call]], "            ")}`;
  });
  out.push(`-- ---- Update --------------------------------------------------------------------


type Msg
    = ${[...stateful.map((w) => `${n(w).ctor} ${MODULE[w.kind]}.Msg`), "Pushed Value"].join("\n    | ")}`);
  out.push(`update : Msg, Model → Model × Cmd Msg
update msg model = ( step msg model, Cmd.none )`);
  out.push(`step : Msg, Model → Model
step msg model =
    case msg of
${arms.join("\n\n")}

        Pushed value →
            pushed value model`);

  // External events
  const tick = clocks.length === 0
    ? "model"
    : set(clocks.map((w) => [n(w).value, `Clock.tick model.${n(w).value}`]), "            ");
  const snapshotFields = stateful.map((w) => [n(w).value, `${MODULE[w.kind]}.replace widgets.${n(w).value} model.${n(w).value}`]);
  const byWidget = (list, call) => list.map((w) =>
    `        ${beniString(w.id)} →\n            ${set([[n(w).value, `${call(w)} model.${n(w).value}`]], "            ")}`).join("\n\n");
  out.push(`-- ---- External events -----------------------------------------------------------


subscriptions : Model → Sub Msg
subscriptions _ = Push.onPush Pushed`);
  out.push(`--| What the host pushes: a widget's new state, a tick of the clocks, an entry
--| for a feed, or a new state for every widget at once.
schema Event tagged "type" of
    ServerSet as "serverSet"
        widget : String
        state : Value
    Tick as "tick"
    Notify as "notify"
        widget : String
        entry : Value
    Snapshot as "snapshot"
        state : Snapshot`);
  out.push(`schema Snapshot =
    widgets : Widgets`);
  out.push(`schema Widgets =
${stateful.map((w) => `    ${n(w).value} : Value as ${beniString(w.id)}`).join("\n")}`);
  out.push(`pushed : Value, Model → Model
pushed value model =
    case Schema.read (Event.schema ⊤) value of
        Ok (Event.ServerSet event) →
            replaced event.widget event.state model

        Ok Event.Tick →
            ${tick}

        Ok (Event.Notify event) →
            ${feeds.length ? "notified event.widget event.entry model" : "model"}

        Ok (Event.Snapshot event) →
            widgets = event.state.widgets
            ${record(snapshotFields, "            ")}

        Err _ →
            model`);
  out.push(`replaced : String, Value, Model → Model
replaced widget state model =
    case widget of
${byWidget(stateful, (w) => `${MODULE[w.kind]}.replace state`)}

        _ →
            model`);
  if (feeds.length) {
    out.push(`notified : String, Value, Model → Model
notified widget entry model =
    case widget of
${byWidget(feeds, () => "Feed.notify entry")}

        _ →
            model`);
  }

  // View
  // A markup hole `{f a b}` at 8 columns, laid out as `beni fmt` does past 100 columns: the
  // closing brace on a line of its own, then each argument on its own line.
  const hole = (fn, args) => {
    const flat = `        {${fn} ${args.join(" ")}`;
    if (flat.length + 1 <= 100) return flat + "}";
    if (flat.length <= 100) return flat + "\n        }";
    return `        {${fn}\n${args.map((a) => "            " + a).join("\n")}\n        }`;
  };
  const views = widgets.map((w) => (w.kind === "summary"
    ? hole("Summary.view", [n(w).value, `(${n(w).line} model)`])
    : hole("Html.map", [`(${MODULE[w.kind]}.view ${n(w).value} model.${n(w).value})`, n(w).ctor])));
  out.push(`-- ---- View ----------------------------------------------------------------------


view : Model → Html Msg
view model =
    <div data-role="dashboard">
${views.join("\n")}
    </div>`);

  const summaries = widgets.filter((w) => w.kind === "summary");
  if (summaries.length) {
    out.push(`-- ---- Summaries -----------------------------------------------------------------`);
    for (const w of summaries) out.push(summaryFunction(spec, w, names));
    if (needsFormatNumber(spec)) {
      out.push(`--| A number rounded to at most two decimals.
formatNumber : Float → String
formatNumber number = Amount.decimal (toFloat (round (number * 100)) / 100)`);
    }
  }
  return out.join("\n\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// The app

export function emitDashboard(spec, templateFiles) {
  const kinds = new Set(spec.widgets.map((w) => w.kind));
  const files = {
    ...templateFiles({ name: `rr-dashboard-n${spec.options.size}-s${spec.options.seed}`, title: `dashboard n=${spec.options.size} seed=${spec.options.seed}` }),
    "src/Main.beni": mainModule(spec),
  };
  for (const k of kinds) files[`src/Widget/${MODULE[k]}.beni`] = KIND_MODULES[k](spec);
  if (kinds.has("tabs") || kinds.has("panel") || kinds.has("rating")) files["src/Ui.beni"] = UI_MODULE;
  // A section's heading comment is followed by one blank line, as `beni fmt` writes it.
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".beni")) files[name] = text.replace(/^(-- ---- .*)\n\n\n/gm, "$1\n\n");
  }
  return { files, style: STYLE };
}
