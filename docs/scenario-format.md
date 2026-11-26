# Scenario format

A scenario is one YAML file. This page describes every field. The bundled
scenarios in [`scenarios/`](../scenarios) are good examples to copy.

## How a scenario runs

- The exercise clock starts at 0 minutes and stops at `limit`.
- **Injects** are messages. Each one arrives at a set time (`at`), when a
  condition becomes true (`when`), or both.
- **Actions** are what the player can do. Each one takes `takes` minutes. The
  clock runs forward by that much, anything due in that time happens, and then
  the action's result and effects apply.
- **Rules** change things in the background: every so often (`every`) while a
  condition holds, or once when a condition first becomes true.
- **Meters** are numbers from 0 to 100 that show the state of things.
- **Flags** are true/false facts, set and cleared by effects.
- **Objectives** are checked once, when the exercise ends. The score is the
  weighted share of objectives hit.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lower case letters, digits and `-`. Used in links and progress. |
| `title` | yes | Short title shown everywhere. |
| `level` | no | `beginner`, `intermediate`, `ot`, `capstone` or `custom` (default). |
| `minutes` | no | Rough playing time, for the scenario list. |
| `sector`, `org` | no | Shown in the briefing. Mark fictional organizations as fictional. |
| `role` | yes | One line telling the player who they are. |
| `summary` | yes | One or two sentences for the scenario list. |
| `start` | no | Story clock at minute 0: `"09:15"` or `"Tue 09:15"`. Default 09:00. |
| `limit` | no | How long the exercise runs: `90`, `8h`, `3d`. Default `8h`. |
| `pass` | no | Pass mark in percent. Default 70. |
| `briefing` | yes | Markdown shown at the start. |
| `meters` | no | See below. |
| `flags` | no | Extra flag names, if you test a flag that nothing sets. |
| `injects`, `actions`, `rules`, `objectives` | | See below. You need at least one action and one objective. |
| `solution` | no, but do it | Steps that should score 100%. The validator plays them. |
| `references` | no | Further reading, shown in the report. |

Durations can be plain minutes (`45`) or use units: `30m`, `2h`, `1h30m`, `1d`.

Text fields support a small Markdown subset: paragraphs, `- ` lists, `**bold**`
and `` `code` ``.

## Meters

```yaml
meters:
  spread:
    label: Attacker reach
    start: 20
    good: low          # low or high: which direction is better
    help: How much of the network the attacker can reach.
```

Effects change meters by a number (`spread: 10`, `trust: -15`). Values are
kept between 0 and 100.

## Injects

```yaml
injects:
  - id: second_victim         # unique across injects and actions
    at: 45                    # arrive at minute 45...
    when: not purged          # ...if this is true then (or later, once it is)
    from: Service desk
    via: chat                 # email, alert, call, chat, ticket, news, team, letter
    subject: Another one
    body: |
      Omar opened that email after all and typed his password in.
    effects:
      set: [omar_phished]
      spread: 15
```

- With only `at`, the inject arrives at that minute.
- With only `when`, it arrives the moment the condition becomes true.
- With both, it arrives at `at` or later, as soon as `when` is true.

`body` can have variants. The first one whose `when` is true is used:

```yaml
    body:
      - when: funds >= 60
        text: The bank froze most of the money.
      - text: The account was almost empty.
```

## Actions

```yaml
actions:
  - id: revoke_sessions
    group: contain            # investigate, contain, operations, communicate, coordinate, recover
    label: Revoke all of Priya's sessions
    takes: 5                  # minutes, or 2h etc.
    when: seen.priya_email    # optional: only offered while this is true
    repeatable: false         # optional: offer it again after it's done
    result:
      - when: creds_reset
        text: The attacker is out.
      - text: Sessions revoked, but the password still works.
    effects:
      set: [sessions_revoked]
      spread: -20
    lesson: |
      Optional. Shown in the debrief if the player took this action.
      Use it to explain why a tempting action was a mistake.
```

An action is offered when it hasn't been done yet (unless `repeatable`) and
its `when` is true. The last `result` variant must have no `when`.

## Rules

```yaml
rules:
  # Every 15 minutes while the condition holds
  - id: attacker_working
    when: attacker_active and not sessions_revoked
    every: 15
    effects:
      spread: 10

  # Once, the first time the condition is true
  - id: ransomware
    when: time >= 3h and not host_isolated
    text: Files on the shared drive start getting a new extension.
    effects:
      end:
        outcome: fail
        text: The loader handed its access to a ransomware group.
```

`text` is optional and appears in the timeline when the rule fires.

## Effects

| Effect | Example | Meaning |
| --- | --- | --- |
| `set` | `set: [isolated, logged]` | Turn flags on. |
| `clear` | `clear: attacker_active` | Turn flags off. |
| `inject` | `inject: vendor_reply` | Deliver an inject now. |
| `end` | `end: close` or `end: { outcome: fail, text: ... }` | End the exercise. `close` is scored normally; `fail` is always a fail. |
| any meter id | `trust: -10` | Change a meter. |

## Conditions

Conditions are short expressions:

```
did.isolate_host and at.isolate_host <= 30
not seen.ransom_note or spread >= 80
time >= at.active_alert + 45m
(did.disable_remote and at.disable_remote <= 60) or did.uninstall_remote
```

| Name | Value |
| --- | --- |
| `time` | Minutes since the start. |
| a meter id | That meter's value. |
| a flag | True if set. |
| `did.<action>` | True once the action has finished. |
| `seen.<inject>` | True once the inject has arrived. |
| `at.<action or inject>` | Minute it finished or arrived, or 99999 if it hasn't. |

Operators: `and`, `or`, `not`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`
and parentheses. Numbers can carry units (`30m`, `2h`, `1d`).

Because `at.x` is 99999 until `x` happens, `at.a < at.b` reads naturally:
true if `a` happened and `b` happened later or not at all.

## Objectives

```yaml
objectives:
  - text: Act before the stolen session gets used
    pass: at.revoke_sessions < at.active_alert
    weight: 2
    hit: You revoked the sessions before the attacker started using them.
    miss: The attacker got to use the session first.
```

The score is the sum of the weights you hit divided by the total, as a
percentage. Write `hit` and `miss` so they teach something on their own: the
debrief shows one of them for every objective.

## Checking a scenario

```
npm run validate-scenarios -- my-scenario.yaml
```

The validator lists every problem it finds (unknown flags, typos in ids,
broken conditions, missing fields), then plays your `solution`. It expects:

- every step in the solution to be available when it's taken,
- the solution to hit every objective without failing,
- doing nothing until time runs out to fall below the pass mark.

Solution steps are action ids, `wait` (until the next message), `wait 30m`,
or `end`.

## Tips for good scenarios

- **Make time matter.** Give the attacker something to do every so often
  until the right action stops them.
- **Add one or two tempting mistakes** with a `lesson`, like pulling the
  power or replying to the fraudster.
- **Let conditions change the story.** Body and result variants make the same
  message different depending on what the player did.
- **Keep everything fictional.** Use made-up organizations and people, and
  say so in `org`.
