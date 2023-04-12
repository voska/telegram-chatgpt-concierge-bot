import dotenv from "dotenv";
dotenv.config();

import { Telegraf, Markup } from "telegraf";
import { message } from 'telegraf/filters';
import { downloadVoiceFile } from "./lib/downloadVoiceFile";
import { postToWhisper } from "./lib/postToWhisper";
import { textToSpeech } from "./lib/htApi";
import { createReadStream, existsSync, mkdirSync } from "fs";
import { Model as ChatModel } from "./models/chat";
import { Model as ChatWithTools } from "./models/chatWithTools";
import { healthcheck } from "./lib/healthcheck";

const workDir = "./tmp";
const telegramToken = process.env.TELEGRAM_TOKEN!;

const bot = new Telegraf(telegramToken);


if (!existsSync(workDir)) {
  mkdirSync(workDir);
}

healthcheck();

bot.start((ctx) => {

  ctx.reply("Welcome to my Telegram bot!");
});

bot.help((ctx) => {
 
  ctx.reply("Send me a message and I will echo it back to you.");
});

bot.on(message('voice'), async (ctx) => {

  if (!(('key_'+ctx.message.chat.id) in chat_maps)) {
    chat_maps['key_'+ctx.message.chat.id] = default_chat_context(ctx.message.chat.id)
  }
  const state = chat_maps['key_'+ctx.message.chat.id]
  
  if (!(valid_ids.includes(''+ctx.update.message.from.id))) {
    const response = 'contact support for enabling this feature'  
    console.log('ACCESS ATTEMPT BY '+ ctx.update.message.from.id)
    await ctx.reply(response);

  } else {

    const voice = ctx.message.voice;
    await ctx.sendChatAction("typing");
  
    const localFilePath = await downloadVoiceFile(workDir, voice.file_id, bot);
    const transcription = await postToWhisper(localFilePath);
  
    await ctx.reply(`Transcription: ${transcription}`);
    await ctx.sendChatAction("typing");
  
    const response = await state.model.call(transcription, ctx,state.memory);
  
  
    await ctx.reply(response);
    const responseTranscriptionPath = await textToSpeech(response);
  
    await ctx.sendChatAction("typing");
  
    await ctx.replyWithVoice({
      source: createReadStream(responseTranscriptionPath),
      filename: localFilePath,
    });
  
  }

  
  
});

const valid_ids = process.env.VALID_IDS || '';
import { BufferMemory } from "langchain/memory";

const chat_maps: any = {}
const default_chat_context= function(id: any) {
  console.log("CREATING NEW MODEL FOR CHAT ID ")
  return {
    model: new ChatWithTools()
  }
}

bot.on(message('text'), async (ctx) => {



  if (!(valid_ids.includes(''+ctx.update.message.from.id))) {
    const response = 'contact support for enabling this feature'  
    console.log('ACCESS ATTEMPT BY '+ ctx.update.message.from.id)
    await ctx.reply(response);
  } else {
    if (!(('key_'+ctx.message.chat.id) in chat_maps)) {
      chat_maps['key_'+ctx.message.chat.id] = default_chat_context(ctx.message.chat.id)
    }
    const state = chat_maps['key_'+ctx.message.chat.id]
  
    const text = (ctx.message as any).text;

    if (!text) {
      ctx.reply("Please send a text message.");
      return;
    }
  
    
    await ctx.sendChatAction("typing");
    const response =  await state.model.call(text, ctx);
    if (response) 
      await ctx.reply(response);
    else
    await ctx.reply("Empty response from the model");
  }

 
});

bot.on(message('location'), (ctx) => {
  /**return ctx.reply(
    'Special buttons keyboard',
    Markup.keyboard([
      Markup.button.contactRequest('Send contact'),
      Markup.button.locationRequest('Send location')
    ]).resize()
  ) */  ctx.editMessageReplyMarkup(undefined)
  console.log(ctx.message.location.latitude);
  console.log(ctx.message.location.longitude);
});

bot.launch();

console.log("Bot started");
