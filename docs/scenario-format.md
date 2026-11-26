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
| `phases` | no | Discussion points. See below. |
| `status` | no | Status indicators shown next to the meters. See below. |
| `attack`, `attack_matrix` | no | The attack path, in MITRE ATT&CK terms. See below. |
| `tailor` | no | Settings a facilitator can change before play. See below. |
| `variants` | no | Random choices that change from run to run. See below. |
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
- With `optional: true`, it only arrives when a facilitator pushes it. See
  [Optional injects](#optional-injects).
- With `chance: 50%` (or `0.5`), it's only in some runs. See
  [Variants and chance](#variants-and-chance).

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

## Discussion phases

Phases are the points where a facilitator would stop the room and ask
questions. Each one is reached at a time (`at`), when a condition becomes true
(`when`), or both, like an inject. The player can write notes, and the notes
go into the report.

```yaml
phases:
  - id: earlier_signs
    title: Earlier warning signs
    at: 0
    text: |
      Looking back:

      - The vendor VPN account had no MFA and was always on.
    questions:
      - Who reviews accounts that cross from IT to OT?
  - id: containment
    title: Cutting the link
    when: it_ot_cut or time >= 30
    questions:
      - Who can order the plant isolated, and who must agree?
```

A phase needs at least one question. A slow-burn opening (warning signs that
were missed before minute 0) works well as the first phase.

## Status indicators

Status items are short labels next to the meters, such as whether a path is
open or the safety system is trusted. The first state whose `when` is true is
shown; the last state must have no `when`.

```yaml
status:
  - id: path
    label: IT to OT path
    states:
      - when: it_ot_cut
        text: Cut
        tone: ok          # ok, warn, bad or info
      - text: Open
        tone: bad
```

The report lists each item as it was at the end.

## Attack path

```yaml
attack_matrix: ics      # ics (default) or enterprise
attack:
  - tactic: Initial Access
    technique: T0822
    name: External Remote Services
    note: A remote desktop tool on the HMI, reachable from the internet.
```

`technique` must look like `T0822` or `T1692.001`. Each step links to the
technique's page on attack.mitre.org in the debrief, the report and the MSEL.
Check the IDs against the current matrix: techniques are sometimes renamed or
replaced.

## Settings (tailoring)

Settings let a facilitator make a scenario fit their site before play. There
are two kinds:

```yaml
tailor:
  - id: org
    label: Organization name
    type: text
    default: Delta Crest Beverages
  - id: golden_images
    label: Offline golden images of the HMIs exist
    type: toggle
    default: true
    help: Without them, rebuilding the HMIs takes most of the day.
```

- A **text** setting fills `{{org}}` anywhere in the file. A value that
  starts with a placeholder must be quoted in YAML: `org: "{{org}}"`.
- A **toggle** is yes or no. When it's yes, the flag with the same id is set
  at the start, so actions and conditions can use it
  (`when: golden_images`). Text can change with it:
  `{{#golden_images}}shown when yes{{/golden_images}}` and
  `{{^golden_images}}shown when no{{/golden_images}}`.

If a toggle changes which actions the model response uses, mark those steps as
optional in the solution with `?`, so the same solution works both ways:

```yaml
solution:
  - ?restore_hmis       # taken if it's available
  - ?rebuild_hmis
```

The browser asks for settings on the setup screen. In the terminal:
`play 8 org="Acme Foods" golden_images=no`.

## Optional injects

Optional injects are for the facilitator. They never arrive on their own;
the facilitator pushes them from the panel during team play, or with `push`
in the terminal. Use them to add pressure, test a quiet seat, or slow down a
team that's moving too fast.

```yaml
  - id: opt_restart_pressure
    optional: true
    when: not logic_restored      # optional: only offered while this is true
    note: Pushes toward a restart before the safety logic can be trusted.
    from: General manager
    via: call
    subject: Every hour costs money
    body: '"Every hour offline costs us 400,000 dollars. Why can't we restart?"'
```

An optional inject has no `at`. The `note` is shown to the facilitator and in
the MSEL. TTXSim also offers six pressure injects that fit any scenario (a
reporter, the CEO, a missing key person, staff posting online, an unrelated
alert, the regulator hearing it elsewhere).

## Variants and chance

Variants change a scenario from run to run, so a team can't learn the answer.
Each run picks one option per group. The chosen option sets the flag
`<group>_<option>`, and `{{group}}` shows its label.

```yaml
variants:
  - id: entry
    label: How the attacker reaches the HMI
    options:
      - id: remote_tool
        label: A remote desktop tool on the HMI with a shared password
      - id: old_vpn
        label: A former integrator's VPN account that was never removed
        weight: 1         # optional, default 1
```

Use the flags in text sections and conditions:
`{{#entry_old_vpn}}The VPN light on the router is on.{{/entry_old_vpn}}`.

An inject with a `chance` is in some runs and not others. When it's out of a
run, it waits in the facilitator's list of optional injects instead.

```yaml
  - id: social_post
    at: 120
    chance: 60%
```

Each run has a number. The same number always gives the same run, so two
groups can play the same one. Without a number, a new one is drawn at random.
The report and the MSEL record the run number and what varied. In the browser
the number is on the setup screen (or `?run=4821` in the address); in the
terminal, add `run=4821` to `play`, `map` or `msel`.

## Checking a scenario

```
npm run validate-scenarios -- my-scenario.yaml
```

The validator lists every problem it finds (unknown flags, typos in ids,
broken conditions, missing fields), then plays your `solution`. It expects:

- every step in the solution to be available when it's taken,
- the solution to hit every objective without failing,
- doing nothing until time runs out to fall below the pass mark,
- pushing every optional inject at the start not to break the solution.

It checks all of that for every combination of toggles, variant options and
chance injects.

Solution steps are action ids, `?id` for a step taken only if it's available,
`wait` (until the next message), `wait 30m`, or `end`.

## Tips for good scenarios

- **Make time matter.** Give the attacker something to do every so often
  until the right action stops them.
- **Add one or two tempting mistakes** with a `lesson`, like pulling the
  power or replying to the fraudster.
- **Let conditions change the story.** Body and result variants make the same
  message different depending on what the player did.
- **Ask the right questions at the right time.** Two or three phases with
  sharp questions do more than a long list at the end.
- **Give the facilitator a few optional injects** with a clear note on when
  to use each one.
- **Keep everything fictional.** Use made-up organizations and people, and
  say so in `org`.
