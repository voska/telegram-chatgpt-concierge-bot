import { createReadStream } from "fs";
import { OpenAIApi } from "openai";
import { Configuration } from "openai";
const openAIApiKey = process.env.OPENAI_API_KEY!;

const configuration = new Configuration({
  apiKey: openAIApiKey,
});
const openai = new OpenAIApi(configuration);

export async function postToWhisper(audioFilePath: string) {

  const transcript = await openai.createTranscription(
    createReadStream(audioFilePath) as any,
    "whisper-1"
  );
  return transcript.data.text;
}
