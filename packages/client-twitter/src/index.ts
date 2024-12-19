import { TwitterSearchClient } from "./search.ts";
import { TwitterInteractionClient } from "./interactions.ts";
import {IAgentRuntime, Client} from "@ai16z/eliza/src/types.ts";

class TwitterAllClient {
    search: TwitterSearchClient;
    interaction: TwitterInteractionClient;

    constructor(runtime: IAgentRuntime) {
        //this.interaction = new TwitterInteractionClient(runtime);
        //todo add back the post service
        console.log('Twitter post service not implemented');
        console.log('Twitter reply service disabled');
    }
}

export const TwitterClientInterface: Client = {
    async start(runtime: IAgentRuntime) {
        console.log("Twitter client starting");
        return new TwitterAllClient(runtime);
    },
    async stop(runtime: IAgentRuntime) {
        console.warn("Twitter client does not support stopping yet");
    },
};
export default TwitterClientInterface;
