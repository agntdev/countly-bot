import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  addAdmin, adjustCounter, createCounter, createInvite, deleteCounter, getCounter,
  isListedAdmin, listAdminIds, listCounters, recentEvents, redeemInvite, removeAdmin, renameCounter,
  setCounter, StorageUnavailable, now,
} from "../counters.js";
import { adminChatId, inlineButton, inlineKeyboard, isOwner, registerMainMenuItem, requireOwner } from "../toolkit/index.js";

registerMainMenuItem({ label: "Create counter", data: "create:counter", order: 30 });
registerMainMenuItem({ label: "Admin desk", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
const back = () => inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
const unavailable = "Counter storage isn't set up yet.";
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;
const counterKeyboard = (id: string) => inlineKeyboard([
  [inlineButton("Add 1", `counter:adjust:${id}:1`), inlineButton("Subtract 1", `counter:adjust:${id}:-1`)],
  [inlineButton("Set value", `counter:set:${id}`), inlineButton("Rename", `counter:rename:${id}`)],
  [inlineButton("Delete", `counter:delete:${id}`), inlineButton("Back", "list:personal")],
]);
async function sharedAdmin(ctx: Ctx): Promise<boolean> {
  if (isOwner(ctx)) return true;
  try {
    const admins = await ctx.getChatAdministrators();
    if (admins.some((member) => member.user.id === ctx.from?.id)) return true;
  } catch { /* private chats have no chat-admin list */ }
  try { return ctx.from ? await isListedAdmin(ctx, ctx.from.id) : false; } catch (e) { if (e instanceof StorageUnavailable) return false; throw e; }
}
async function allowed(ctx: Ctx, counter: { type: string; creator_id: number }): Promise<boolean> {
  if (counter.type === "personal") return counter.creator_id === ctx.from?.id;
  return sharedAdmin(ctx);
}
async function notifyShared(ctx: Ctx, text: string): Promise<void> {
  const target = adminChatId(ctx);
  if (!target) return;
  try { await ctx.api.sendMessage(target, text); } catch { /* blocking the bot must not block a counter update */ }
}
function view(counter: { id: string; name: string; current_value: number }) { return `${counter.name}: ${counter.current_value}`; }

composer.callbackQuery("create:counter", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText("Choose the counter type.", { reply_markup: inlineKeyboard([
    [inlineButton("Personal", "create:type:personal"), inlineButton("Shared", "create:type:shared")],
    [inlineButton("Back to menu", "menu:main")],
  ]) });
});
composer.callbackQuery(/^create:type:(personal|shared)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const type = ctx.match[1] as "personal" | "shared";
  if (type === "shared" && !(await sharedAdmin(ctx))) { await ctx.reply("Only a shared-counter admin can create that."); return; }
  ctx.session.draftType = type; ctx.session.step = "awaiting_counter_name"; ctx.session.flowStartedAt = now().getTime();
  await ctx.reply(`Send a name for your ${type} counter.`, { reply_markup: { force_reply: true, input_field_placeholder: "Type a counter name" } });
});
composer.on("message:text", async (ctx, next) => {
  if (ctx.message.text.startsWith("/")) return next();
  if (ctx.session.step !== "idle" && ctx.session.flowStartedAt !== undefined && now().getTime() - ctx.session.flowStartedAt > FLOW_TIMEOUT_MS) {
    ctx.session.step = "idle"; ctx.session.draftType = undefined; ctx.session.selectedCounterId = undefined; ctx.session.flowStartedAt = undefined;
    await ctx.reply("That edit step expired. Tap Create counter to start again.");
    return;
  }
  if (ctx.session.step === "awaiting_counter_name") {
    const name = ctx.message.text.trim();
    if (name.length < 1 || name.length > 60) { await ctx.reply("Use a counter name between 1 and 60 characters."); return; }
    const type = ctx.session.draftType;
    if (!type || !ctx.from) { ctx.session.step = "idle"; await ctx.reply("That creation step expired. Tap Create counter to start again."); return; }
    if (type === "shared" && !(await sharedAdmin(ctx))) { ctx.session.step = "idle"; await ctx.reply("Only a shared-counter admin can create that."); return; }
    try {
      const counter = await createCounter(ctx, name, type, ctx.from.id); ctx.session.step = "idle"; ctx.session.flowStartedAt = undefined;
      await ctx.reply(`Created ${counter.name} at 0.`, { reply_markup: counterKeyboard(counter.id) });
      if (type === "shared") await notifyShared(ctx, `Shared counter created: ${counter.name} at 0.`);
    } catch (e) {
      if (e instanceof StorageUnavailable) await ctx.reply(unavailable);
      else await ctx.reply("A counter with that name already exists. Choose a different name.");
    }
    return;
  }
  if (ctx.session.step === "awaiting_rename" || ctx.session.step === "awaiting_set_value") {
    const counterId = ctx.session.selectedCounterId; if (!counterId || !ctx.from) { ctx.session.step = "idle"; await ctx.reply("That edit step expired. Open the counter and try again."); return; }
    try {
      const counter = await getCounter(ctx, counterId); if (!counter || !(await allowed(ctx, counter))) { ctx.session.step = "idle"; await ctx.reply("You can't change that counter."); return; }
      if (ctx.session.step === "awaiting_rename") {
        const name = ctx.message.text.trim(); if (!name || name.length > 60) { await ctx.reply("Use a counter name between 1 and 60 characters."); return; }
        const updated = await renameCounter(ctx, counter, name, ctx.from.id); ctx.session.step = "idle"; ctx.session.flowStartedAt = undefined; await ctx.reply(`Renamed to ${updated.name}.`, { reply_markup: counterKeyboard(updated.id) });
        if (updated.type === "shared") await notifyShared(ctx, `Shared counter renamed to ${updated.name}.`);
      } else {
        const value = Number(ctx.message.text.trim()); if (!Number.isSafeInteger(value)) { await ctx.reply("Send a whole number, such as 12 or -3."); return; }
        const updated = await setCounter(ctx, counter, value, ctx.from.id); ctx.session.step = "idle"; ctx.session.flowStartedAt = undefined; await ctx.reply(`${updated.name}: ${updated.current_value}`, { reply_markup: counterKeyboard(updated.id) });
        if (updated.type === "shared") await notifyShared(ctx, `Shared counter changed: ${updated.name} is now ${updated.current_value}.`);
      }
    } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else await ctx.reply("A counter with that name already exists. Choose a different name."); }
    return;
  }
  return next();
});
composer.callbackQuery(/^counter:open:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const counter = await getCounter(ctx, ctx.match[1]); if (!counter || !(await allowed(ctx, counter))) { await ctx.reply("You can't open that counter."); return; } await ctx.editMessageText(view(counter), { reply_markup: counterKeyboard(counter.id) }); }
  catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else await ctx.reply("That counter is no longer available."); }
});
composer.callbackQuery(/^counter:adjust:([\w-]+):(-?1)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const counter = await getCounter(ctx, ctx.match[1]); if (!counter || !ctx.from || !(await allowed(ctx, counter))) { await ctx.reply("You can't change that counter."); return; } const updated = await adjustCounter(ctx, counter, Number(ctx.match[2]), ctx.from.id); await ctx.editMessageText(view(updated), { reply_markup: counterKeyboard(updated.id) }); if (updated.type === "shared") await notifyShared(ctx, `Shared counter changed: ${updated.name} is now ${updated.current_value}.`); }
  catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else await ctx.reply("That counter is no longer available."); }
});
composer.callbackQuery(/^counter:(set|rename):([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const action = ctx.match[1]; const id = ctx.match[2];
  try { const counter = await getCounter(ctx, id); if (!counter || !(await allowed(ctx, counter))) { await ctx.reply("You can't change that counter."); return; } ctx.session.selectedCounterId = id; ctx.session.step = action === "set" ? "awaiting_set_value" : "awaiting_rename"; ctx.session.flowStartedAt = now().getTime(); await ctx.reply(action === "set" ? "Send the new whole-number value." : "Send the new counter name.", { reply_markup: { force_reply: true, input_field_placeholder: action === "set" ? "Type a whole number" : "Type a new name" } }); }
  catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else await ctx.reply("That counter is no longer available."); }
});
composer.callbackQuery(/^counter:delete:([\w-]+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText("Delete this counter? Its history will stay in the event log.", { reply_markup: inlineKeyboard([[inlineButton("Delete counter", `counter:deleteyes:${ctx.match[1]}`), inlineButton("Keep counter", `counter:open:${ctx.match[1]}`)]]) }); });
composer.callbackQuery(/^counter:deleteyes:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); try { const counter = await getCounter(ctx, ctx.match[1]); if (!counter || !ctx.from || !(await allowed(ctx, counter))) { await ctx.reply("You can't delete that counter."); return; } await deleteCounter(ctx, counter, ctx.from.id); await ctx.editMessageText("Counter deleted. Its history remains in the event log.", { reply_markup: back() }); if (counter.type === "shared") await notifyShared(ctx, `Shared counter deleted: ${counter.name}.`); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else await ctx.reply("That counter is no longer available."); }
});
composer.callbackQuery("admin:desk", async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx))) return;
  try { const events = await recentEvents(ctx); const summary = events.length ? events.map((e) => `${e.action}: ${e.new_value}`).join("\n") : "No counter activity yet."; const notification = adminChatId(ctx) ? "Shared-change notifications are active." : "Shared-change notifications aren't set up yet."; await ctx.reply(`${notification}\n\nRecent activity\n${summary}`, { reply_markup: inlineKeyboard([[inlineButton("Create admin invite", "admin:invite")], [inlineButton("Edit saved admins", "admin:list")], [inlineButton("Back to menu", "menu:main")]]) }); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else throw e; }
});
composer.callbackQuery("admin:invite", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx))) return; try { const code = await createInvite(ctx); await ctx.reply(`Share this admin join code privately: ${code}\nThe recipient opens the bot and uses /start ${code}.`); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else throw e; } });
composer.callbackQuery("admin:list", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx))) return; try { const admins = await listAdminIds(ctx); if (!admins.length) { await ctx.reply("No saved admins yet — create an invite to add one."); return; } await ctx.reply("Saved admins", { reply_markup: inlineKeyboard([...admins.map((admin, i) => [inlineButton(`Remove saved admin ${i + 1}`, `admin:remove:${admin}`)]), [inlineButton("Back to admin desk", "admin:desk")]]) }); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else throw e; } });
composer.callbackQuery(/^admin:remove:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx))) return; try { await removeAdmin(ctx, Number(ctx.match[1])); await ctx.reply("Saved admin access removed."); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else throw e; } });
composer.command("start", async (ctx, next) => { const code = ctx.match?.trim(); if (!code || !ctx.from) return next(); try { if (await redeemInvite(ctx, code, ctx.from.id)) await ctx.reply("You're now approved to manage shared counters."); else await ctx.reply("That admin invite isn't valid anymore."); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply(unavailable); else throw e; } return next(); });
export default composer;
