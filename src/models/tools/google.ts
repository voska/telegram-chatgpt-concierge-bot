import { DynamicTool } from "langchain/tools";
import google from "googlethis";
import { ChatOpenAI } from "langchain/chat_models";
import { HumanChatMessage, SystemChatMessage } from "langchain/schema";


export class GoogleTool extends DynamicTool {

  constructor(llm: ChatOpenAI, question: string) {
    super({
      name: "Google",
      description:
        "useful to research current events",
      func: async (searchPhrase: string) => {
        const response = await google.search(searchPhrase, {
          page: 0,
          safe: false, // Safe Search
          parse_ads: false, // If set to true sponsored results will be parsed
          additional_params: {
            // add additional parameters here, see https://moz.com/blog/the-ultimate-guide-to-the-google-search-parameters and https://www.seoquake.com/blog/google-search-param/
          },
        });
    

        const cr = await llm.call([
          new SystemChatMessage(
            "answer these questions:  \n- " + question + '\n- ' + searchPhrase  +"\nfrom this text: "
          ),
          new HumanChatMessage(
            JSON.stringify({
              results: response.results,
              featured: response.featured_snippet,
            })
          ),
        ]);
        return cr.text;
      },
    })
  }
}
