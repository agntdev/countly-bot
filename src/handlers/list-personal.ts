import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { listCounters, StorageUnavailable } from "../counters.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
registerMainMenuItem({ label: "My counters", data: "list:personal", order: 10 });
const composer = new Composer<Ctx>();
composer.callbackQuery("list:personal", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const counters = await listCounters(ctx, "personal", ctx.from?.id ?? 0); if (!counters.length) { await ctx.editMessageText("No personal counters yet — tap Create counter to add one.", { reply_markup: inlineKeyboard([[inlineButton("Create counter", "create:counter")], [inlineButton("Back to menu", "menu:main")]]) }); return; } await ctx.editMessageText("Your counters", { reply_markup: inlineKeyboard([...counters.map((c) => [inlineButton(`${c.name}: ${c.current_value}`, `counter:open:${c.id}`)]), [inlineButton("Create counter", "create:counter"), inlineButton("Back to menu", "menu:main")]]) }); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply("Counter storage isn't set up yet."); else throw e; }
});
export default composer;
