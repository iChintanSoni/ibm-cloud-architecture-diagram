/**
 * The app's one child-to-container inset convention: how close a child is expected to sit to its
 * parent Box/Group/Zone's own edge, used consistently across authoring, interaction, and
 * validation rather than each independently guessing the same number. Before M27.6 this value was
 * six independent literal `16`s (interaction/snapping.ts's PARENT_INSET, interaction/resize.ts's
 * reflowChildren default, scene/bounds.ts's autoFitContainer default, commands/commands.ts's
 * autoGrowContainer default, api/createEditor.ts's groupElements default, and
 * linter/rules.ts's CONTAINER_INSET) that happened to agree, not because anything enforced
 * agreement — a real risk of silent drift if any one of them were ever tuned in isolation.
 *
 * Lives in scene/ (not interaction/ or linter/) since it's the lowest-level module every consumer
 * already sits above or beside, avoiding any import-direction risk.
 */
export const CONTAINER_CHILD_PADDING_PX = 16;
