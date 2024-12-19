//build fails with this file
import { SearchMode, Tweet } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "@ai16z/eliza/src/context.ts";
import {
    generateMessageResponse,
    generateShouldRespond,
} from "@ai16z/eliza/src/generation.ts";
import {
    messageCompletionFooter,
    shouldRespondFooter,
} from "@ai16z/eliza/src/parsing.ts";
import {
    Content, HandlerCallback,
    Memory,
    ModelClass,
    IAgentRuntime,
    State,
    UUID
} from "@ai16z/eliza/src/types.ts";
import { stringToUuid } from "@ai16z/eliza/src/uuid.ts";
import { ClientBase } from "./base.ts";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";
import {embeddingZeroVector} from "@ai16z/eliza/src/memory.ts";
import path from "path";
import {fileURLToPath} from "url";

export const twitterMessageHandlerTemplate =
    `{{timeline}}

# Knowledge
{{knowledge}}

# Task: Generate a post for the character {{agentName}}.
About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

{{mentionContext}}

Available Character Twitter Handles:
- Dottie: @Dottie_FXN
- JustBang: @justFXNbang
- Johnny Chain: @JohnnyFXNChain
- Joi: @joi_fxn
- FXN: @joinFXN
- Tony Amari: @ImFXNTony

Rules for this post:
- Do not use any hashtags or emojis.
- Use at most one @ mention.

# Task: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}):
{{currentPost}}

` + messageCompletionFooter;

export const twitterShouldRespondTemplate =
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

{{recentPosts}}

IMPORTANT: {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

{{currentPost}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TwitterInteractionClient extends ClientBase {
    private lastTweetTime: number = 0;
    private readonly MINIMUM_TWEET_INTERVAL = 5 * 60 * 1000; // 2 minutes in milliseconds
    private static readonly TIMELINE_FILENAME = "home_timeline.json";
    private static readonly CACHE_DIR = "tweetcache";


    constructor(runtime: IAgentRuntime) {
        super({
            runtime,
        });
    }

    onReady() {
        const handleTwitterInteractionsLoop = () => {
            this.handleTwitterInteractions();
            setTimeout(handleTwitterInteractionsLoop, (Math.floor(Math.random() * (5 - 2 + 1)) + 2) * 60 * 1000); // Fixed 5 minute interval
        };
        handleTwitterInteractionsLoop();
    }


    private get cacheDir(): string {
        return path.join(__dirname, TwitterInteractionClient.CACHE_DIR);
    }

    private get timelinePath(): string {
        return path.join(this.cacheDir, TwitterInteractionClient.TIMELINE_FILENAME);
    }

    private canTweetNow(): boolean {
        const now = Date.now();
        const timeSinceLastTweet = now - this.lastTweetTime;
        return timeSinceLastTweet >= this.MINIMUM_TWEET_INTERVAL;
    }

    private updateLastTweetTime() {
        this.lastTweetTime = Date.now();
    }

    private async getMentionContext(roomId: UUID): Promise<string> {
        const recentMentions = await this.runtime.messageManager.getMemories({
            roomId,
            count: 10,
            unique: true
        });

        const mentionThreads = recentMentions
            .filter(memory => memory.content.metadata?.mention)
            .map(memory => {
                const { sourceActor } = memory.content.metadata.mention;
                return `Actor${sourceActor.order || 0}: ${memory.content.text}
Tweet: ${memory.content.metadata.tweet?.url || 'N/A'}`;
            });

        return mentionThreads.length > 0
            ? `# Recent mentions of other members of the FXN group in this conversation:\n${mentionThreads.join('\n\n')}`
            : '';
    }

    async handleTwitterInteractions() {
        const tweetCacheFilePath = __dirname + "/tweetcache/latest_checked_tweet_id.txt";
        const dir = path.dirname(tweetCacheFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        try {
            // Check for mentions
            const tweetCandidates = (
                await this.fetchSearchTweets(
                    `@${this.runtime.getSetting("TWITTER_USERNAME")}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;

            // Filter out self-tweets and duplicates early
            const uniqueTweetCandidates = [...new Set(tweetCandidates)]
                .filter(tweet => tweet.userId !== this.twitterUserId)
                .sort((a, b) => a.id.localeCompare(b.id));

            console.log(`Found ${uniqueTweetCandidates.length} valid mentions to process`);

            // for each tweet candidate, handle the tweet
            for (const tweet of uniqueTweetCandidates) {
                // Double-check we're not replying to ourselves and that enough time has passed
                if (!this.canTweetNow()) {
                    console.log("Rate limit reached, skipping remaining tweets");
                    break;
                }

                if (
                    !this.lastCheckedTweetId ||
                    parseInt(tweet.id) > this.lastCheckedTweetId
                ) {
                    const conversationId =
                        tweet.conversationId + "-" + this.runtime.agentId;

                    const roomId = stringToUuid(conversationId);
                    const userIdUUID = stringToUuid(tweet.userId as string);

                    await this.runtime.ensureConnection(
                        userIdUUID,
                        roomId,
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );

                    await buildConversationThread(tweet, this);

                    const message = {
                        content: {
                            text: tweet.text,
                            action: 'TWEET_ACTION',
                            metadata: {
                                mention: true, // Add this flag for mentions
                                tweetId: tweet.id,
                                tweetUrl: tweet.permanentUrl,
                                sender: {
                                    id: tweet.userId,
                                    name: tweet.name,
                                    role: 'actor'
                                }
                            }
                        },
                        agentId: this.runtime.agentId,
                        userId: userIdUUID,
                        roomId
                    };

                    await this.handleTweet({
                        tweet,
                        message,
                    });

                    // Update tweet timestamps after successful handling
                    this.updateLastTweetTime();
                    this.lastCheckedTweetId = parseInt(tweet.id);

                    try {
                        if (this.lastCheckedTweetId) {
                            fs.writeFileSync(
                                this.tweetCacheFilePath,
                                this.lastCheckedTweetId.toString(),
                                "utf-8"
                            );
                        }
                    } catch (error) {
                        console.error(
                            "Error saving latest checked tweet ID to file:",
                            error
                        );
                    }
                }
            }

            console.log("Finished checking Twitter interactions");
        } catch (error) {
            console.error("Error handling Twitter interactions:", error);
        }
    }

    private async handleTweet({
                                  tweet,
                                  message,
                              }: {
        tweet: Tweet;
        message: Memory;
    }) {
        // Additional safety check for self-replies
        if (tweet.username === this.runtime.getSetting("TWITTER_USERNAME")) {
            console.log("skipping tweet from bot itself", tweet.id);
            return { text: "", action: "IGNORE" };
        }

        if (!message.content.text) {
            console.log("skipping tweet with no text", tweet.id);
            return { text: "", action: "IGNORE" };
        }
        console.log("handling tweet", tweet.id);
        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);

        let homeTimeline = [];
        // Try to read existing timeline
        const tweetCacheDir = path.join(__dirname, "tweetcache");
        const timelinePath = path.join(tweetCacheDir, "home_timeline.json");
        try {
            if (!fs.existsSync(tweetCacheDir)) {
                fs.mkdirSync(tweetCacheDir, { recursive: true });
            }
            if (fs.existsSync(timelinePath)) {
                const fileContent = fs.readFileSync(timelinePath, "utf-8");
                homeTimeline = JSON.parse(fileContent);

                // Check if timeline is stale (older than 1 hour)
                const stats = fs.statSync(timelinePath);
                const isStale = (Date.now() - stats.mtimeMs) > (60 * 60 * 1000);

                if (isStale) {
                    console.log("Timeline cache is stale, fetching new timeline");
                    homeTimeline = await this.fetchHomeTimeline(50);
                }
            } else {
                console.log("No timeline cache found, fetching new timeline");
                homeTimeline = await this.fetchHomeTimeline(50);
            }
        } catch (error) {
            console.error("Error reading timeline cache, fetching new timeline:", error);
            homeTimeline = await this.fetchHomeTimeline(50);
        }

        try {
            fs.writeFileSync(timelinePath, JSON.stringify(homeTimeline, null, 2));
        } catch (error) {
            console.error("Error writing timeline cache:", error);
            // Continue execution even if cache write fails
        }

        const formattedHomeTimeline =
            `# ${this.runtime.character.name}'s Home Timeline\n\n` +
            homeTimeline
                .map((tweet) => {
                    return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${
                        tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""
                    }\nText: ${tweet.text}\n---\n`;
                })
                .join("\n");

        let state = await this.runtime.composeState(message, {
            twitterClient: this.twitterClient,
            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
            currentPost,
            timeline: formattedHomeTimeline,
            mentionContext: await this.getMentionContext(message.roomId)
        });

        // check if the tweet exists, save if it doesn't
        const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        if (!tweetExists) {
            console.log("tweet does not exist, saving");
            const userIdUUID = stringToUuid(tweet.userId as string);
            const roomId = stringToUuid(tweet.conversationId);

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(
                            tweet.inReplyToStatusId +
                            "-" +
                            this.runtime.agentId
                        )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
                embedding: embeddingZeroVector,  // Added missing required field
            };
            await this.saveRequestMessage(message, state);
        }

        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterShouldRespondTemplate ||
                this.runtime.character?.templates?.shouldRespondTemplate ||
                twitterShouldRespondTemplate,
        });

        const shouldRespond = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.SMALL,
        });

        if (!shouldRespond) {
            console.log("Not responding to message");
            return { text: "", action: "IGNORE" };
        }

        const context = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                this.runtime.character?.templates?.messageHandlerTemplate ||
                twitterMessageHandlerTemplate,
        });

        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.SMALL,
        });

        const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

        response.inReplyTo = stringId;

        if (response.text) {
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this,
                        response,
                        message.roomId,
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        tweet.id
                    );
                    return memories;
                };

                const responseMessages = await callback(response);

                state = (await this.runtime.updateRecentMessageState(
                    state
                )) as State;

                for (const responseMessage of responseMessages) {
                    await this.runtime.messageManager.createMemory(
                        responseMessage
                    );
                }

                await this.runtime.evaluate(message, state);

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state
                );
                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;
                // f tweets folder dont exist, create
                if (!fs.existsSync("tweets")) {
                    fs.mkdirSync("tweets");
                }
                const debugFileName = `tweets/tweet_generation_${tweet.id}.txt`;
                fs.writeFileSync(debugFileName, responseInfo);
                await wait();
            } catch (error) {
                console.error(`Error sending response tweet: ${error}`);
            }
        }
    }
}
