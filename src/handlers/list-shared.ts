import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { listCounters, StorageUnavailable } from "../counters.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
registerMainMenuItem({ label: "Shared counters", data: "list:shared", order: 20 });
const composer = new Composer<Ctx>();
composer.callbackQuery("list:shared", async (ctx) => {
  await ctx.answerCallbackQuery();
  try { const counters = await listCounters(ctx, "shared", 0); if (!counters.length) { await ctx.editMessageText("No shared counters yet — an admin can tap Create counter to add one.", { reply_markup: inlineKeyboard([[inlineButton("Create counter", "create:counter")], [inlineButton("Back to menu", "menu:main")]]) }); return; } await ctx.editMessageText("Shared counters", { reply_markup: inlineKeyboard([...counters.map((c) => [inlineButton(`${c.name}: ${c.current_value}`, `counter:open:${c.id}`)]), [inlineButton("Back to menu", "menu:main")]]) }); } catch (e) { if (e instanceof StorageUnavailable) await ctx.reply("Counter storage isn't set up yet."); else throw e; }
});
export default composer;
