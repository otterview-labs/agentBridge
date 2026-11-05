# Office Town pixel scenes

These project assets were generated with the built-in image generation tool from the three UI concepts approved in this conversation. The exact prompts are saved under `.impeccable/assets/` at the repository root and embedded in the PNG metadata. No generated UI comp is used as a live page background.

| Asset | Runtime purpose | Prompt |
| --- | --- | --- |
| `floor-room.png` | Modular office floor behind real employee rows | `floor-room.prompt.txt` |
| `town-ground.png` | Town terrain behind selectable computer buildings | `town-ground.prompt.txt` |
| `office-building.png` | Transparent building representing one real computer | `office-building.prompt.txt` |
| `focus-room.png` | Selected computer's office; proportional crop at short landscape height | `focus-room.prompt.txt` |
| `butler-reception.png` | Standalone butler at the reception and in chat | Reused from the user-approved 2026-10-14 receptionist refinement |
| `employee-sprites.png` | Transparent 3 × 2 sprite sheet: Codex, Claude, butler; front and top views | `employee-sprites.prompt.txt` |

Computer names, task names, counts, connection labels, pending questions, summaries and all actions are HTML rendered from the native state. Room decoration, workstation equipment and monitor pixels are illustrative. Sprite color follows `task.agentType`; it does not identify a person or reproduce a remote desktop. Unsupported agent types retain their existing distinct avatar.

`machine.id` identifies a room/building; `task.id` and `task.machineId` identify its employee workstation and click target. Theme selection stores only `floors`, `map` or `workstations` in `officeSceneV1`, never machine credentials or task content. No workers or buildings are created to fill unused scene space. Offline/unchecked buildings and task records have a muted historical appearance and no working animation.

Browser regression screenshots contain explicitly synthetic fixtures from `android/tests/phone-ui.test.cjs`. They verify interactions and bindings; they are not a capture of a user's SSH computers. Device verification and strict design-comp review are tracked separately in `.impeccable/review/` and `.impeccable/build/`.
