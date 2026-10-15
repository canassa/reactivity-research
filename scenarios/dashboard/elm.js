// The dashboard in Elm 0.19.
//
// Style (recorded in every generated app's rr.json), following the Elm guide and common
// practice:
// - The Elm Architecture with `Browser.element`: one `Model` record holding every widget's
//   state (one field per widget), one `update`, one `view`. Summaries keep no state: their line
//   is computed from the model in `view`.
// - Shared components: each widget kind is written once, as one module (`Widget.Counter`,
//   `Widget.Todo`, …) organised around its types, as the guide's "Structure" chapter advises.
//   It exposes its `Model`, `Msg`, a `Config` record for what varies per instance (label,
//   texts, limits, items, rules), `update`, `view` and a JSON `decoder`. No view or update code
//   is emitted per widget: `Main` holds one `Config` value per widget (data, plus a
//   function-valued rule or format where one is needed), one `Model` field of its kind's type,
//   and one `Msg` constructor wrapping its kind's `Msg`, routed by one-line branches in
//   `update`, the decoders and `view` (`Html.map`). Only `Counter.update` takes its config
//   (step and limits).
// - Per-instance rules are built from small helpers of their kind's module:
//   `Field.required`/`minLength`/`matching` (elm/regex, only where a pattern rule exists) and
//   `Amount.currency`/`percent`/`unit`.
// - Keyed lists with `Html.Keyed` (todo, filter, feed); conditional content as an optional
//   last child; plain `Html.Events` handlers (`onInput` for text inputs and the select,
//   `onClick` for buttons and checkboxes, as the guide's examples do), and a decoder that fails
//   on anything but a number for the amount input, so it only sends a message for a number.
// - External events arrive through one incoming port, `events : (Value -> msg) -> Sub msg`,
//   decoded with `Json.Decode` into the app's own messages: `serverSet` into the widget's
//   `Replaced` message, `notify` into the feed's `Notified`, `tick` into `Tick`, `snapshot` into
//   `GotSnapshot` with a whole new `Model`.
// - Production build: `elm make --optimize`, then the guide's two uglify-js passes.

import { templateFiles } from "../../frameworks/elm/framework.js";
import { camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "elm";

export const params = {};

const MODULE = {
  counter: "Counter", toggles: "Toggles", field: "Field", todo: "Todo", tabs: "Tabs", panel: "Panel",
  choice: "Choice", amount: "Amount", filter: "Filter", rating: "Rating", feed: "Feed", clock: "Clock",
  summary: "Summary",
};

// ---------------------------------------------------------------------------------------------
// Elm literals

export function elmString(s) {
  return '"' + String(s).replace(/[\\"\n\r\t]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]) + '"';
}

// An Elm expression for plain data (records, lists, strings, numbers, booleans), laid out the
// way elm-format would: on one line when short, else one item per line with leading commas.
export function elmValue(value, indent = "") {
  if (typeof value === "string") return elmString(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  const inner = indent + "    ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => elmValue(v, inner));
    const flat = `[ ${items.join(", ")} ]`;
    if (flat.length + indent.length <= 100 && !flat.includes("\n")) return flat;
    return `\n${inner}[ ${items.join(`\n${inner}, `)}\n${inner}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${k} =${fieldValue(v, inner)}`);
  const flat = `{ ${entries.join(", ")} }`;
  if (flat.length + indent.length <= 100 && !flat.includes("\n")) return flat;
  return `\n${inner}{ ${entries.join(`\n${inner}, `)}\n${inner}}`;
}

// ---------------------------------------------------------------------------------------------
// The shared module and one module per widget kind

const UI = `module Ui exposing (ariaFlag, dataKey, dataRole, widget)

{-| What every widget's view shares: the section with its heading, and the attributes the
dashboard's markup uses.
-}

import Html exposing (Attribute, Html, h2, section, text)
import Html.Attributes exposing (attribute)


widget : String -> { a | id : String, label : String } -> List (Html msg) -> Html msg
widget kind config children =
    section [ dataKey config.id, dataRole ("widget-" ++ kind) ]
        (h2 [] [ text config.label ] :: children)


dataRole : String -> Attribute msg
dataRole =
    attribute "data-role"


dataKey : String -> Attribute msg
dataKey =
    attribute "data-key"


ariaFlag : String -> Bool -> Attribute msg
ariaFlag name on =
    attribute ("aria-" ++ name)
        (if on then
            "true"

         else
            "false"
        )
`;

const KIND_MODULES = {
  counter: `module Widget.Counter exposing (Config, Model, Msg(..), decoder, update, view)

import Html exposing (Html, button, output, text)
import Html.Attributes exposing (disabled)
import Html.Events exposing (onClick)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataRole)


type alias Config =
    { id : String
    , label : String
    , step : Int
    , min : Int
    , max : Int
    , start : Int
    }


type alias Model =
    { value : Int }


type Msg
    = Increment
    | Decrement
    | Reset
    | Replaced Model


update : Config -> Msg -> Model -> Model
update config msg model =
    case msg of
        Increment ->
            { model | value = Basics.min config.max (model.value + config.step) }

        Decrement ->
            { model | value = Basics.max config.min (model.value - config.step) }

        Reset ->
            { model | value = config.start }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "counter"
        config
        [ output [ dataRole "value" ] [ text (String.fromInt model.value) ]
        , button [ dataRole "dec", disabled (model.value <= config.min), onClick Decrement ]
            [ text ("-" ++ String.fromInt config.step) ]
        , button [ dataRole "inc", disabled (model.value >= config.max), onClick Increment ]
            [ text ("+" ++ String.fromInt config.step) ]
        , button [ dataRole "reset", onClick Reset ] [ text "Reset" ]
        ]


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "value" Decode.int)
`,

  toggles: `module Widget.Toggles exposing (Config, Model, Msg(..), count, decoder, update, view)

import Html exposing (Html, input, label, li, p, text, ul)
import Html.Attributes exposing (checked, type_)
import Html.Events exposing (onClick)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataKey, dataRole)


type alias Config =
    { id : String
    , label : String
    , items : List String
    }


type alias Model =
    { on : List Bool }


type Msg
    = Toggle Int
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Toggle index ->
            { model
                | on =
                    List.indexedMap
                        (\\i on ->
                            if i == index then
                                not on

                            else
                                on
                        )
                        model.on
            }

        Replaced new ->
            new


count : Model -> Int
count model =
    List.length (List.filter identity model.on)


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "toggles"
        config
        [ ul [] (List.indexedMap viewToggle (List.map2 Tuple.pair config.items model.on))
        , p [ dataRole "count" ]
            [ text (String.fromInt (count model) ++ " of " ++ String.fromInt (List.length config.items) ++ " on") ]
        ]


viewToggle : Int -> ( String, Bool ) -> Html Msg
viewToggle index ( name, on ) =
    li []
        [ label []
            [ input [ type_ "checkbox", dataRole "toggle", dataKey (String.fromInt index), checked on, onClick (Toggle index) ] []
            , text name
            ]
        ]


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "on" (Decode.list Decode.bool))
`,

  field: (spec) => {
    const rules = new Set(spec.widgets.filter((w) => w.kind === "field").map((w) => w.rule.type));
    const helpers = [];
    const exposed = [];
    if (rules.has("required")) {
      exposed.push("required");
      helpers.push(`required : String -> String -> Maybe String
required message text =
    if String.isEmpty (String.trim text) then
        Just message

    else
        Nothing`);
    }
    if (rules.has("minLength")) {
      exposed.push("minLength");
      helpers.push(`minLength : Int -> String -> String -> Maybe String
minLength min message text =
    if String.length text < min then
        Just message

    else
        Nothing`);
    }
    if (rules.has("pattern")) {
      exposed.push("matching");
      helpers.push(`matching : String -> String -> String -> Maybe String
matching source message =
    let
        regex =
            Maybe.withDefault Regex.never (Regex.fromString source)
    in
    \\text ->
        if Regex.contains regex text then
            Nothing

        else
            Just message`);
    }
    return `module Widget.Field exposing (Config, Model, Msg(..), decoder, ${exposed.sort().join(", ")}, update, view)

import Html exposing (Html, input, p, text)
import Html.Attributes exposing (placeholder, type_, value)
import Html.Events exposing (onInput)
import Json.Decode as Decode exposing (Decoder)
${rules.has("pattern") ? "import Regex\n" : ""}import Ui exposing (dataRole)


type alias Config =
    { id : String
    , label : String
    , placeholder : String
    , validate : String -> Maybe String
    }


type alias Model =
    { text : String }


type Msg
    = Edited String
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Edited text ->
            { model | text = text }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "field"
        config
        (input [ type_ "text", dataRole "input", placeholder config.placeholder, value model.text, onInput Edited ] []
            :: (case config.validate model.text of
                    Just error ->
                        [ p [ dataRole "error" ] [ text error ] ]

                    Nothing ->
                        []
               )
        )


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "text" Decode.string)



-- RULES


${helpers.join("\n\n\n")}
`;
  },

  todo: `module Widget.Todo exposing (Config, Item, Model, Msg(..), decoder, left, update, view)

import Html exposing (Html, button, input, li, p, span, text)
import Html.Attributes exposing (checked, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import Html.Keyed as Keyed
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataKey, dataRole)


type alias Config =
    { id : String
    , label : String
    , placeholder : String
    , addText : String
    , removeText : String
    }


type alias Item =
    { id : Int
    , text : String
    , done : Bool
    }


type alias Model =
    { items : List Item
    , draft : String
    }


type Msg
    = DraftEdited String
    | Add
    | Toggle Int
    | Remove Int
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        DraftEdited draft ->
            { model | draft = draft }

        Add ->
            let
                trimmed =
                    String.trim model.draft

                nextId =
                    1 + List.foldl (\\item highest -> max item.id highest) 0 model.items
            in
            if String.isEmpty trimmed then
                model

            else
                { items = model.items ++ [ Item nextId trimmed False ], draft = "" }

        Toggle id ->
            { model
                | items =
                    List.map
                        (\\item ->
                            if item.id == id then
                                { item | done = not item.done }

                            else
                                item
                        )
                        model.items
            }

        Remove id ->
            { model | items = List.filter (\\item -> item.id /= id) model.items }

        Replaced new ->
            new


left : Model -> Int
left model =
    List.length (List.filter (not << .done) model.items)


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "todo"
        config
        [ input [ type_ "text", dataRole "draft", placeholder config.placeholder, value model.draft, onInput DraftEdited ] []
        , button [ dataRole "add", onClick Add ] [ text config.addText ]
        , Keyed.ul [] (List.map (viewItem config) model.items)
        , p [ dataRole "left" ] [ text (String.fromInt (left model) ++ " left") ]
        ]


viewItem : Config -> Item -> ( String, Html Msg )
viewItem config item =
    ( String.fromInt item.id
    , li [ dataKey (String.fromInt item.id) ]
        [ input [ type_ "checkbox", dataRole "toggle", checked item.done, onClick (Toggle item.id) ] []
        , span [] [ text item.text ]
        , button [ dataRole "remove", onClick (Remove item.id) ] [ text config.removeText ]
        ]
    )


decoder : Decoder Model
decoder =
    Decode.map2 Model
        (Decode.field "items" (Decode.list itemDecoder))
        (Decode.field "draft" Decode.string)


itemDecoder : Decoder Item
itemDecoder =
    Decode.map3 Item
        (Decode.field "id" Decode.int)
        (Decode.field "text" Decode.string)
        (Decode.field "done" Decode.bool)
`,

  tabs: `module Widget.Tabs exposing (Config, Model, Msg(..), Tab, decoder, update, view)

import Html exposing (Html, button, div, p, text)
import Html.Attributes exposing (attribute)
import Html.Events exposing (onClick)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (ariaFlag, dataKey, dataRole)


type alias Tab =
    { title : String
    , content : String
    }


type alias Config =
    { id : String
    , label : String
    , tabs : List Tab
    }


type alias Model =
    { active : Int }


type Msg
    = Select Int
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Select index ->
            { model | active = index }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "tabs"
        config
        [ div [ attribute "role" "tablist" ] (List.indexedMap (viewTab model.active) config.tabs)
        , p [ attribute "role" "tabpanel", dataRole "tab-content" ]
            [ text
                (List.drop model.active config.tabs
                    |> List.head
                    |> Maybe.map .content
                    |> Maybe.withDefault ""
                )
            ]
        ]


viewTab : Int -> Int -> Tab -> Html Msg
viewTab active index tab =
    button
        [ attribute "role" "tab"
        , dataRole "tab"
        , dataKey (String.fromInt index)
        , ariaFlag "selected" (index == active)
        , onClick (Select index)
        ]
        [ text tab.title ]


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "active" Decode.int)
`,

  panel: `module Widget.Panel exposing (Config, Model, Msg(..), decoder, update, view)

import Html exposing (Html, button, p, text)
import Html.Events exposing (onClick)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (ariaFlag, dataRole)


type alias Config =
    { id : String
    , label : String
    , showText : String
    , hideText : String
    , body : String
    }


type alias Model =
    { open : Bool }


type Msg
    = Toggle
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Toggle ->
            { model | open = not model.open }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "panel"
        config
        (button [ dataRole "toggle", ariaFlag "expanded" model.open, onClick Toggle ]
            [ text
                (if model.open then
                    config.hideText

                 else
                    config.showText
                )
            ]
            :: (if model.open then
                    [ p [ dataRole "body" ] [ text config.body ] ]

                else
                    []
               )
        )


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "open" Decode.bool)
`,

  choice: `module Widget.Choice exposing (Config, Model, Msg(..), Option, decoder, update, view)

import Html exposing (Html, input, option, select, text)
import Html.Attributes exposing (placeholder, selected, type_, value)
import Html.Events exposing (onInput)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataRole)


type alias Option =
    { value : String
    , label : String
    }


type alias Config =
    { id : String
    , label : String
    , options : List Option
    , extraFor : List String
    , extraPlaceholder : String
    }


type alias Model =
    { option : String
    , extra : String
    }


type Msg
    = Chose String
    | ExtraEdited String
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Chose option ->
            { model | option = option }

        ExtraEdited extra ->
            { model | extra = extra }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "choice"
        config
        (select [ dataRole "select", onInput Chose ] (List.map (viewOption model.option) config.options)
            :: (if List.member model.option config.extraFor then
                    [ input
                        [ type_ "text"
                        , dataRole "extra"
                        , placeholder config.extraPlaceholder
                        , value model.extra
                        , onInput ExtraEdited
                        ]
                        []
                    ]

                else
                    []
               )
        )


viewOption : String -> Option -> Html Msg
viewOption current choice =
    option [ value choice.value, selected (choice.value == current) ] [ text choice.label ]


decoder : Decoder Model
decoder =
    Decode.map2 Model
        (Decode.field "option" Decode.string)
        (Decode.field "extra" Decode.string)
`,

  amount: (spec) => {
    const types = new Set(spec.widgets.filter((w) => w.kind === "amount").map((w) => w.format.type));
    const helpers = [];
    const exposed = [];
    if (types.has("currency")) {
      exposed.push("currency");
      helpers.push(`currency : String -> Int -> Float -> String
currency symbol decimals amount =
    symbol ++ fixed decimals amount`);
    }
    if (types.has("percent")) {
      exposed.push("percent");
      helpers.push(`percent : Int -> Float -> String
percent decimals amount =
    fixed decimals amount ++ "%"`);
    }
    if (types.has("unit")) {
      exposed.push("unit");
      helpers.push(`unit : String -> Int -> Float -> String
unit name decimals amount =
    fixed decimals amount ++ " " ++ name`);
    }
    return `module Widget.Amount exposing (Config, Model, Msg(..), ${exposed.sort().join(", ")}, decoder, update, view)

import Html exposing (Html, input, output, text)
import Html.Attributes exposing (type_, value)
import Html.Events exposing (stopPropagationOn, targetValue)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataRole)


type alias Config =
    { id : String
    , label : String
    , format : Float -> String
    }


type alias Model =
    { value : Float }


type Msg
    = Set Float
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Set amount ->
            { model | value = amount }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "amount"
        config
        [ input [ type_ "number", dataRole "input", value (String.fromFloat model.value), onNumberInput Set ] []
        , output [ dataRole "formatted" ] [ text (config.format model.value) ]
        ]


{-| Only a number makes a message: while the input holds anything else (empty, a lone "-"),
the decoder fails, nothing is sent, and the input keeps what the user typed. Like \`onInput\`,
it stops propagation, which makes Elm redraw at once rather than on the next frame.
-}
onNumberInput : (Float -> msg) -> Html.Attribute msg
onNumberInput toMsg =
    stopPropagationOn "input"
        (targetValue
            |> Decode.andThen
                (\\raw ->
                    case String.toFloat raw of
                        Just amount ->
                            Decode.succeed ( toMsg amount, True )

                        Nothing ->
                            Decode.fail "not a number"
                )
        )


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "value" Decode.float)



-- FORMATS


${helpers.join("\n\n\n")}


{-| The amount with exactly \`decimals\` digits after the point.
-}
fixed : Int -> Float -> String
fixed decimals amount =
    let
        digits =
            String.padLeft (decimals + 1) '0' (String.fromInt (round (abs amount * toFloat (10 ^ decimals))))

        sign =
            if amount < 0 then
                "-"

            else
                ""
    in
    if decimals == 0 then
        sign ++ digits

    else
        sign ++ String.dropRight decimals digits ++ "." ++ String.right decimals digits
`;
  },

  filter: `module Widget.Filter exposing (Config, Item, Model, Msg(..), decoder, matches, update, view)

import Html exposing (Html, input, li, p, text)
import Html.Attributes exposing (placeholder, type_, value)
import Html.Events exposing (onInput)
import Html.Keyed as Keyed
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataKey, dataRole)


type alias Item =
    { id : Int
    , text : String
    }


type alias Config =
    { id : String
    , label : String
    , items : List Item
    , placeholder : String
    }


type alias Model =
    { query : String }


type Msg
    = QueryEdited String
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        QueryEdited query ->
            { model | query = query }

        Replaced new ->
            new


matches : List Item -> String -> List Item
matches items query =
    let
        lowered =
            String.toLower query
    in
    List.filter (\\item -> String.contains lowered (String.toLower item.text)) items


view : Config -> Model -> Html Msg
view config model =
    let
        shown =
            matches config.items model.query
    in
    Ui.widget "filter"
        config
        [ input [ type_ "text", dataRole "query", placeholder config.placeholder, value model.query, onInput QueryEdited ] []
        , Keyed.ul [] (List.map viewItem shown)
        , p [ dataRole "matches" ] [ text (String.fromInt (List.length shown) ++ " matches") ]
        ]


viewItem : Item -> ( String, Html Msg )
viewItem item =
    ( String.fromInt item.id, li [ dataKey (String.fromInt item.id) ] [ text item.text ] )


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "query" Decode.string)
`,

  rating: `module Widget.Rating exposing (Config, Model, Msg(..), decoder, update, view)

import Html exposing (Html, button, div, p, text)
import Html.Events exposing (onClick)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (ariaFlag, dataKey, dataRole)


type alias Config =
    { id : String
    , label : String
    , stars : Int
    , labels : List String
    }


type alias Model =
    { stars : Int }


type Msg
    = Rate Int
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Rate stars ->
            { model | stars = stars }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "rating"
        config
        [ div [] (List.map (viewStar model.stars) (List.range 1 config.stars))
        , p [ dataRole "rating-label" ]
            [ text (List.drop model.stars config.labels |> List.head |> Maybe.withDefault "") ]
        ]


viewStar : Int -> Int -> Html Msg
viewStar stars n =
    button [ dataRole "star", dataKey (String.fromInt n), ariaFlag "pressed" (n <= stars), onClick (Rate n) ]
        [ text
            (if n <= stars then
                "★"

             else
                "☆"
            )
        ]


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "stars" Decode.int)
`,

  feed: `module Widget.Feed exposing (Config, Entry, Model, Msg(..), decoder, entryDecoder, update, view)

import Html exposing (Html, button, li, p, span, text)
import Html.Events exposing (onClick)
import Html.Keyed as Keyed
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataKey, dataRole)


type alias Config =
    { id : String
    , label : String
    , emptyText : String
    , dismissText : String
    }


type alias Entry =
    { id : Int
    , text : String
    }


type alias Model =
    { entries : List Entry }


type Msg
    = Dismiss Int
    | Notified Entry
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Dismiss id ->
            { model | entries = List.filter (\\entry -> entry.id /= id) model.entries }

        Notified entry ->
            { model | entries = model.entries ++ [ entry ] }

        Replaced new ->
            new


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "feed"
        config
        (Keyed.ul [] (List.map (viewEntry config) model.entries)
            :: (if List.isEmpty model.entries then
                    [ p [ dataRole "empty" ] [ text config.emptyText ] ]

                else
                    []
               )
        )


viewEntry : Config -> Entry -> ( String, Html Msg )
viewEntry config entry =
    ( String.fromInt entry.id
    , li [ dataKey (String.fromInt entry.id) ]
        [ span [] [ text entry.text ]
        , button [ dataRole "dismiss", onClick (Dismiss entry.id) ] [ text config.dismissText ]
        ]
    )


decoder : Decoder Model
decoder =
    Decode.map Model (Decode.field "entries" (Decode.list entryDecoder))


entryDecoder : Decoder Entry
entryDecoder =
    Decode.map2 Entry
        (Decode.field "id" Decode.int)
        (Decode.field "text" Decode.string)
`,

  clock: `module Widget.Clock exposing (Config, Model, Msg(..), decoder, tick, update, view)

import Html exposing (Html, button, output, text)
import Html.Attributes exposing (disabled)
import Html.Events exposing (onClick)
import Json.Decode as Decode exposing (Decoder)
import Ui exposing (dataRole)


type alias Config =
    { id : String
    , label : String
    , startText : String
    , stopText : String
    , resetText : String
    }


type alias Model =
    { seconds : Int
    , running : Bool
    }


type Msg
    = Start
    | Stop
    | Reset
    | Replaced Model


update : Msg -> Model -> Model
update msg model =
    case msg of
        Start ->
            { model | running = True }

        Stop ->
            { model | running = False }

        Reset ->
            { seconds = 0, running = False }

        Replaced new ->
            new


{-| One second more, if running. Time only moves when the dashboard is told it did.
-}
tick : Model -> Model
tick model =
    if model.running then
        { model | seconds = model.seconds + 1 }

    else
        model


view : Config -> Model -> Html Msg
view config model =
    Ui.widget "clock"
        config
        [ output [ dataRole "time" ] [ text (formatTime model.seconds) ]
        , button [ dataRole "start", disabled model.running, onClick Start ] [ text config.startText ]
        , button [ dataRole "stop", disabled (not model.running), onClick Stop ] [ text config.stopText ]
        , button [ dataRole "reset", onClick Reset ] [ text config.resetText ]
        ]


formatTime : Int -> String
formatTime seconds =
    String.fromInt (seconds // 60) ++ ":" ++ String.padLeft 2 '0' (String.fromInt (modBy 60 seconds))


decoder : Decoder Model
decoder =
    Decode.map2 Model
        (Decode.field "seconds" Decode.int)
        (Decode.field "running" Decode.bool)
`,

  summary: `module Widget.Summary exposing (Config, view)

import Html exposing (Html, p, text)
import Ui exposing (dataRole)


type alias Config =
    { id : String
    , label : String
    }


{-| A summary has no state of its own: its line is computed from the widgets it reads.
-}
view : Config -> String -> Html msg
view config line =
    Ui.widget "summary" config [ p [ dataRole "summary" ] [ text line ] ]
`,
};

// ---------------------------------------------------------------------------------------------
// Main

// The per-instance configuration of a widget, as an Elm record expression.
function configExpr(w) {
  const base = { id: w.id, label: w.label };
  const rec = (fields) => elmValue({ ...base, ...fields }, "");
  switch (w.kind) {
    case "counter": return rec({ step: w.step, min: w.min, max: w.max, start: w.start });
    case "toggles": return rec({ items: w.items });
    case "field": return withRaw(rec({ placeholder: w.placeholder, validate: RAW }), "validate", validateExpr(w.rule));
    case "todo": return rec({ placeholder: w.placeholder, addText: w.addText, removeText: w.removeText });
    case "tabs": return rec({ tabs: w.tabs });
    case "panel": return rec({ showText: w.showText, hideText: w.hideText, body: w.body });
    case "choice": return rec({ options: w.options, extraFor: w.extraFor, extraPlaceholder: w.extraPlaceholder });
    case "amount": return withRaw(rec({ format: RAW }), "format", formatExpr(w.format));
    case "filter": return rec({ items: w.items, placeholder: w.placeholder });
    case "rating": return rec({ stars: w.stars, labels: w.labels });
    case "feed": return rec({ emptyText: w.emptyText, dismissText: w.dismissText });
    case "clock": return rec({ startText: w.startText, stopText: w.stopText, resetText: w.resetText });
    case "summary": return rec({});
  }
  throw new Error(`no config for ${w.kind}`);
}

// A placeholder for a field whose value is an expression, not data.
const RAW = "\u0000raw\u0000";
function withRaw(text, field, expr) {
  return text.replace(`${field} = ${elmString(RAW)}`, `${field} = ${expr}`);
}

function validateExpr(rule) {
  const msg = elmString(rule.message);
  if (rule.type === "required") return `Field.required ${msg}`;
  if (rule.type === "minLength") return `Field.minLength ${rule.min} ${msg}`;
  return `Field.matching ${elmString(rule.pattern)} ${msg}`;
}

function formatExpr(f) {
  if (f.type === "currency") return `Amount.currency ${elmString(f.symbol)} ${f.decimals}`;
  if (f.type === "percent") return `Amount.percent ${f.decimals}`;
  return `Amount.unit ${elmString(f.unit)} ${f.decimals}`;
}

// Names: a widget's config value, model field and message constructor are named after its
// label (labels are unique), as a person naming them would.
function namer(spec) {
  const used = new Set(["main", "init", "update", "view", "subscriptions", "events", "initialModel",
    "modelDecoder", "eventDecoder", "serverState", "notification", "andMap", "formatNumber"]);
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

// The number a summary reads from a widget: [Elm expression, its type].
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
  const show = (b) => (b.type === "Float" ? `formatNumber ${b.name}` : `String.fromInt ${b.name}`);
  const total = decimal
    ? `formatNumber (${bindings.map((b) => (b.type === "Float" ? b.name : `toFloat ${b.name}`)).join(" + ")})`
    : `String.fromInt (${bindings.map((b) => b.name).join(" + ")})`;
  // The line as a list of parts: literal strings and expressions, joined with ++.
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
  // Merge adjacent strings.
  const merged = [];
  for (const p of parts) {
    if (typeof p === "string" && typeof merged[merged.length - 1] === "string") merged[merged.length - 1] += p;
    else merged.push(p);
  }
  const line = merged.map((p) => (typeof p === "string" ? elmString(p) : /\s/.test(p.e) ? `(${p.e})` : p.e));
  const n = names[w.id];
  return `${n.line} : Model -> String
${n.line} model =
    let
${bindings.map((b) => `        ${b.name} =\n            ${b.expr}`).join("\n\n")}
    in
    ${line.join("\n        ++ ")}`;
}

function needsFormatNumber(spec) {
  return spec.widgets.some((w) => w.kind === "summary" && w.sources.some((id) => spec.widgets.find((x) => x.id === id).kind === "amount"));
}

function mainModule(spec) {
  const names = namer(spec);
  const widgets = spec.widgets;
  const stateful = widgets.filter((w) => w.kind !== "summary");
  const kinds = [...new Set(widgets.map((w) => w.kind))];
  const clocks = stateful.filter((w) => w.kind === "clock");
  const feeds = stateful.filter((w) => w.kind === "feed");
  const n = (w) => names[w.id];
  const out = [];

  const imports = [
    "import Browser",
    "import Html exposing (Html, div)",
    "import Json.Decode as Decode exposing (Decoder)",
    "import Ui",
    ...kinds.map((k) => `import Widget.${MODULE[k]} as ${MODULE[k]}`).sort(),
  ];
  out.push(`port module Main exposing (main)

${imports.join("\n")}


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }


{-| External events (server pushes, ticks, snapshots), as JSON.
-}
port events : (Decode.Value -> msg) -> Sub msg`);

  // MODEL
  out.push(`-- MODEL


type alias Model =
    { ${stateful.map((w) => `${n(w).value} : ${MODULE[w.kind]}.Model`).join("\n    , ")}
    }


init : () -> ( Model, Cmd Msg )
init _ =
    ( initialModel, Cmd.none )


initialModel : Model
initialModel =
    { ${stateful.map((w) => `${n(w).value} =${fieldValue(spec.initialState.widgets[w.id], "    ")}`).join("\n    , ")}
    }`);

  // WIDGETS
  out.push(`-- WIDGETS


${widgets.map((w) => `${n(w).value} : ${MODULE[w.kind]}.Config
${n(w).value} =${blockValue(configExpr(w))}`).join("\n\n\n")}`);

  // UPDATE
  const ctors = [...stateful.map((w) => `${n(w).ctor} ${MODULE[w.kind]}.Msg`)];
  if (clocks.length) ctors.push("Tick");
  ctors.push("GotSnapshot Model", "UnknownEvent");
  const cases = stateful.map((w) => {
    const call = w.kind === "counter" ? `Counter.update ${n(w).value} widgetMsg` : `${MODULE[w.kind]}.update widgetMsg`;
    return `        ${n(w).ctor} widgetMsg ->
            ( { model | ${n(w).value} = ${call} model.${n(w).value} }, Cmd.none )`;
  });
  if (clocks.length) {
    cases.push(`        Tick ->
            ( { model
                | ${clocks.map((w) => `${n(w).value} = Clock.tick model.${n(w).value}`).join("\n                , ")}
              }
            , Cmd.none
            )`);
  }
  cases.push(`        GotSnapshot snapshot ->
            ( snapshot, Cmd.none )`);
  cases.push(`        UnknownEvent ->
            ( model, Cmd.none )`);
  out.push(`-- UPDATE


type Msg
    = ${ctors.join("\n    | ")}


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
${cases.join("\n\n")}`);

  // SUBSCRIPTIONS
  const eventCases = [`                    "serverSet" ->
                        Decode.field "widget" Decode.string
                            |> Decode.andThen (\\id -> Decode.field "state" (serverState id))`];
  if (clocks.length) eventCases.push(`                    "tick" ->
                        Decode.succeed Tick`);
  if (feeds.length) eventCases.push(`                    "notify" ->
                        Decode.field "widget" Decode.string
                            |> Decode.andThen (\\id -> Decode.field "entry" (notification id))`);
  eventCases.push(`                    "snapshot" ->
                        Decode.map GotSnapshot (Decode.field "state" (Decode.field "widgets" modelDecoder))`);
  eventCases.push(`                    _ ->
                        Decode.fail ("unknown event: " ++ kind)`);
  const serverCases = stateful.map((w) => `        ${elmString(w.id)} ->
            Decode.map (${n(w).ctor} << ${MODULE[w.kind]}.Replaced) ${MODULE[w.kind]}.decoder`);
  serverCases.push(`        _ ->
            Decode.fail ("unknown widget: " ++ id)`);
  const notifyCases = feeds.map((w) => `        ${elmString(w.id)} ->
            Decode.map (${n(w).ctor} << Feed.Notified) Feed.entryDecoder`);
  notifyCases.push(`        _ ->
            Decode.fail ("no feed: " ++ id)`);
  out.push(`-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions _ =
    events (Decode.decodeValue eventDecoder >> Result.withDefault UnknownEvent)


eventDecoder : Decoder Msg
eventDecoder =
    Decode.field "type" Decode.string
        |> Decode.andThen
            (\\kind ->
                case kind of
${eventCases.join("\n\n")}
            )


serverState : String -> Decoder Msg
serverState id =
    case id of
${serverCases.join("\n\n")}
${feeds.length ? `

notification : String -> Decoder Msg
notification id =
    case id of
${notifyCases.join("\n\n")}
` : ""}

modelDecoder : Decoder Model
modelDecoder =
    Decode.succeed Model
        ${stateful.map((w) => `|> andMap (Decode.field ${elmString(w.id)} ${MODULE[w.kind]}.decoder)`).join("\n        ")}


andMap : Decoder a -> Decoder (a -> b) -> Decoder b
andMap =
    Decode.map2 (|>)`);

  // VIEW
  const views = widgets.map((w) => (w.kind === "summary"
    ? `Summary.view ${n(w).value} (${n(w).line} model)`
    : `Html.map ${n(w).ctor} (${MODULE[w.kind]}.view ${n(w).value} model.${n(w).value})`));
  out.push(`-- VIEW


view : Model -> Html Msg
view model =
    div [ Ui.dataRole "dashboard" ]
        [ ${views.join("\n        , ")}
        ]`);

  const summaries = widgets.filter((w) => w.kind === "summary");
  if (summaries.length) {
    out.push(`-- SUMMARIES


${summaries.map((w) => summaryFunction(spec, w, names)).join("\n\n\n")}`);
    if (needsFormatNumber(spec)) {
      out.push(`{-| A number rounded to at most two decimals.
-}
formatNumber : Float -> String
formatNumber number =
    String.fromFloat (toFloat (round (number * 100)) / 100)`);
    }
  }
  return out.join("\n\n\n") + "\n";
}

// A declaration's body: on the next line, indented.
function blockValue(e) {
  return e.startsWith("\n") ? e : "\n    " + e;
}

// A record field's value: on the same line when short, else on the next lines.
function fieldValue(v, indent) {
  const e = elmValue(v, indent);
  return e.startsWith("\n") ? e : " " + e;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ title: "Dashboard" }),
    "src/Main.elm": mainModule(spec),
    "src/Ui.elm": UI,
  };
  for (const kind of new Set(spec.widgets.map((w) => w.kind))) {
    const m = KIND_MODULES[kind];
    files[`src/Widget/${MODULE[kind]}.elm`] = typeof m === "function" ? m(spec) : m;
  }
  return {
    files,
    style: {
      architecture: "TEA with Browser.element: one Model record (a field per widget), one update, one view",
      components: "shared components: one module per widget kind (Model, Msg, Config, update, view, decoder), written once; per widget only a Config value, a Model field and a Msg constructor wrapping its kind's Msg, routed in update, the decoders and view (Html.map)",
      configuration: "a Config record per widget; rules and formats built with the kind module's helpers (Field.required/minLength/matching, Amount.currency/percent/unit)",
      externalEvents: "one incoming port; Json.Decode into the app's messages (serverSet → the widget's Replaced, notify → Feed.Notified, tick → Tick, snapshot → GotSnapshot)",
      lists: "Html.Keyed for todo, filter and feed",
      conditionals: "an optional last child",
      derived: "computed in view (summary lines, todo left, filter matches)",
      events: "onInput for text inputs and the select, onClick for buttons and checkboxes, a number-only input decoder for the amount",
      build: "elm make --optimize, then uglify-js compress (pure_funcs) and mangle passes, as the Elm guide recommends",
    },
  };
}
