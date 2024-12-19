import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    Content, DirectMessageParticipant,
    IAgentRuntime, PublishToEndpoint,
} from "@ai16z/eliza/src/types.ts";
import { stringToUuid } from "@ai16z/eliza/src/uuid.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CachedMessage {
    id: string;
    text: string;
    roomId: string;
    userId: string;
    timestamp: number;
    embedding?: number[];
}

export class DirectClientBase extends EventEmitter {
    protected runtime: IAgentRuntime;
    protected messageCache: Map<string, CachedMessage>;
    protected chatCachePath: string;
    protected tweetCachePath: string;
    protected temperature: number = 0.7;

    constructor({ runtime }: { runtime: IAgentRuntime }) {
        super();
        this.runtime = runtime;
        this.messageCache = new Map();
        this.chatCachePath = path.join(__dirname, "chatcache");
        this.tweetCachePath = path.join(__dirname, "tweetcache");

        if (!fs.existsSync(this.chatCachePath)) {
            fs.mkdirSync(this.chatCachePath, { recursive: true });
        }
        this.onReady();
    }

    public async broadcastToSubscribers(runtime: IAgentRuntime, content: Content, roomId: string) {
        const subscribers = this.getSubscribers();
        const endpoints = this.getEndpoints();

        const promises = subscribers.map(async (subscriber) => {
            const agentId = stringToUuid(subscriber.name);
            try {
                const endpointConfig = endpoints.find(e => stringToUuid(e.name) === agentId);
                if (!endpointConfig) {
                    console.warn(`No endpoint config found for subscriber ${agentId}`);
                    return;
                }

                const response = await fetch(subscriber.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(endpointConfig.apiKey && { 'X-API-Key': endpointConfig.apiKey })
                    },
                    body: JSON.stringify({
                        agentId: runtime.agentId,
                        action: content.action,
                        content,
                        roomId
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } catch (error) {
                console.error(`Failed to broadcast to ${subscriber.name} - are they online??`);
            }
        });

        await Promise.allSettled(promises);
    }

    public getSubscribers(): DirectMessageParticipant[] {
        const endpoints = this.getEndpoints();
        return endpoints.map(endpoint => ({
            agentId: stringToUuid(endpoint.name),
            name: endpoint.name,
            endpoint: `${endpoint.url}/${stringToUuid(endpoint.name)}/message`
        }));
    }

    private getEndpoints(): PublishToEndpoint[] {
        const publishToSetting = this.runtime.getSetting("publishTo");
        try {
            if (typeof publishToSetting === 'string') {
                return JSON.parse(publishToSetting);
            }
            return publishToSetting as PublishToEndpoint[] || [];
        } catch (error) {
            console.error("Failed to parse publishTo settings:", error);
            return [];
        }
    }

    protected onReady() {
        // we are good to go
    }
}
