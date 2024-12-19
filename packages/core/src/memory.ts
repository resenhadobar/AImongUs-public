import { embed } from "./embedding.ts";
import {
    IAgentRuntime,
    IMemoryManager,
    type Memory,
    PerformanceAwareContent,
    PerformanceContent,
    PerformanceMessage,
    PerformanceMetadata,
    PerformanceQueryOptions,
    type UUID,
} from "./types.ts";
import path from "path";
import fs from "fs";
import {stringToUuid} from "./uuid.ts";
import {fileURLToPath} from "url";

export const embeddingDimension = 1536;
export const embeddingZeroVector = Array(embeddingDimension).fill(0);

const defaultMatchThreshold = 0.1;
const defaultMatchCount = 10;

/**
 * Manage memories in the database.
 */
export class MemoryManager implements IMemoryManager {
    /**
     * The AgentRuntime instance associated with this manager.
     */
    runtime: IAgentRuntime;

    /**
     * The name of the database table this manager operates on.
     */
    tableName: string;

    /**
     * Constructs a new MemoryManager instance.
     * @param opts Options for the manager.
     * @param opts.tableName The name of the table this manager will operate on.
     * @param opts.runtime The AgentRuntime instance associated with this manager.
     */
    constructor(opts: { tableName: string; runtime: IAgentRuntime }) {
        this.runtime = opts.runtime;
        this.tableName = opts.tableName;
    }

    /**
     * Adds an embedding vector to a memory object. If the memory already has an embedding, it is returned as is.
     * @param memory The memory object to add an embedding to.
     * @returns A Promise resolving to the memory object, potentially updated with an embedding vector.
     */
    async addEmbeddingToMemory(memory: Memory): Promise<Memory> {
        if (memory.embedding) {
            return memory;
        }

        const memoryText = memory.content.text;
        if (!memoryText) throw new Error("Memory content is empty");
        memory.embedding = memoryText
            ? await embed(this.runtime, memoryText)
            : embeddingZeroVector.slice();
        return memory;
    }

    /**
     * Retrieves a list of memories by user IDs, with optional deduplication.
     * @param opts Options including user IDs, count, and uniqueness.
     * @param opts.roomId The room ID to retrieve memories for.
     * @param opts.count The number of memories to retrieve.
     * @param opts.unique Whether to retrieve unique memories only.
     * @returns A Promise resolving to an array of Memory objects.
     */
    async getMemories({
        roomId,
        count = 10,
        unique = true,
        agentId,
        start,
        end,
    }: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        const result = await this.runtime.databaseAdapter.getMemories({
            roomId,
            count,
            unique,
            tableName: this.tableName,
            agentId,
            start,
            end,
        });
        return result;
    }

    async getCachedEmbeddings(content: string): Promise<
        {
            embedding: number[];
            levenshtein_score: number;
        }[]
    > {
        const result = await this.runtime.databaseAdapter.getCachedEmbeddings({
            query_table_name: this.tableName,
            query_threshold: 2,
            query_input: content,
            query_field_name: "content",
            query_field_sub_name: "content",
            query_match_count: 10,
        });
        return result;
    }

    /**
     * Searches for memories similar to a given embedding vector.
     * @param embedding The embedding vector to search with.
     * @param opts Options including match threshold, count, user IDs, and uniqueness.
     * @param opts.match_threshold The similarity threshold for matching memories.
     * @param opts.count The maximum number of memories to retrieve.
     * @param opts.roomId The room ID to retrieve memories for.
     * @param opts.unique Whether to retrieve unique memories only.
     * @returns A Promise resolving to an array of Memory objects that match the embedding.
     */
    async searchMemoriesByEmbedding(
        embedding: number[],
        opts: {
            match_threshold?: number;
            agentId?: UUID;
            count?: number;
            roomId: UUID;
            unique?: boolean;
        }
    ): Promise<Memory[]> {
        const {
            match_threshold = defaultMatchThreshold,
            count = defaultMatchCount,
            roomId,
            unique,
        } = opts;

        const searchOpts = {
            tableName: this.tableName,
            roomId,
            embedding: embedding,
            match_threshold: match_threshold,
            match_count: count,
            unique: !!unique,
        };

        const result =
            await this.runtime.databaseAdapter.searchMemories(searchOpts);

        return result;
    }

    /**
     * Creates a new memory in the database, with an option to check for similarity before insertion.
     * @param memory The memory object to create.
     * @param unique Whether to check for similarity before insertion.
     * @returns A Promise that resolves when the operation completes.
     */
    async createMemory(memory: Memory, unique = false): Promise<void> {
        const existingMessage =
            await this.runtime.databaseAdapter.getMemoryById(memory.id);
        if (existingMessage) {
            // console.log("Memory already exists, skipping");
            return;
        }
        await this.runtime.databaseAdapter.createMemory(
            memory,
            this.tableName,
            unique
        );
    }

    async getMemoriesByRoomIds(params: {
        agentId?: UUID;
        roomIds: UUID[];
    }): Promise<Memory[]> {
        const result = await this.runtime.databaseAdapter.getMemoriesByRoomIds({
            agentId: params.agentId,
            roomIds: params.roomIds,
        });
        return result;
    }

    async getMemoryById(id: UUID): Promise<Memory | null> {
        const result = await this.runtime.databaseAdapter.getMemoryById(id);
        return result;
    }

    /**
     * Removes a memory from the database by its ID.
     * @param memoryId The ID of the memory to remove.
     * @returns A Promise that resolves when the operation completes.
     */
    async removeMemory(memoryId: UUID): Promise<void> {
        await this.runtime.databaseAdapter.removeMemory(
            memoryId,
            this.tableName
        );
    }

    /**
     * Removes all memories associated with a set of user IDs.
     * @param roomId The room ID to remove memories for.
     * @returns A Promise that resolves when the operation completes.
     */
    async removeAllMemories(roomId: UUID): Promise<void> {
        await this.runtime.databaseAdapter.removeAllMemories(
            roomId,
            this.tableName
        );
    }

    /**
     * Counts the number of memories associated with a set of user IDs, with an option for uniqueness.
     * @param roomId The room ID to count memories for.
     * @param unique Whether to count unique memories only.
     * @returns A Promise resolving to the count of memories.
     */
    async countMemories(roomId: UUID, unique = true): Promise<number> {
        return await this.runtime.databaseAdapter.countMemories(
            roomId,
            unique,
            this.tableName
        );
    }

    async getCurrentPerformance(roomId: UUID): Promise<PerformanceMetadata | null> {
        const recentMemories = await this.getMemories({
            roomId,
            count: 10,
            unique: false
        });

        console.log('All memories: ', recentMemories);

        const performanceMemory = recentMemories.find(memory => {
            console.log('Checking memory content:', memory.content);
            return memory.content.source === 'control' &&
                memory.content.metadata?.performance?.isLive === true;
        });

        console.log('Got memories: ', performanceMemory);

        return performanceMemory?.content.metadata.performance || null;
    }

    /**
     * Retrieves performance messages based on query options
     */
    async getPerformanceMemories(roomId: UUID, options: PerformanceQueryOptions): Promise<Memory[]> {
        const query = {
            roomId,
            count: options.limit || 10,
        };

        const memories = await this.getMemories(query);

        return memories.filter(memory => {
            const metadata = memory.content.metadata;

            if (!metadata?.performance) {
                return false;
            }

            if (options.performanceId && metadata.performance.id !== options.performanceId) {
                return false;
            }

            if (options.isLive !== undefined && metadata.performance.isLive !== options.isLive) {
                return false;
            }

            if (options.speaker && metadata.performance.lastSpeaker !== options.speaker) {
                return false;
            }

            if (options.startTime && memory.createdAt < options.startTime) {
                return false;
            }

            if (options.endTime && memory.createdAt > options.endTime) {
                return false;
            }

            if (!options.includeBeats && memory.content.source === 'control') {
                return false;
            }

            return true;
        }).sort((a, b) => {
            const direction = options.sortDirection === 'asc' ? 1 : -1;
            return direction * (a.createdAt - b.createdAt);
        });
    }

    /**
     * Gets the most recent messages from the current performance
     */
    async getRecentPerformanceMessages(roomId: UUID, count: number = 5): Promise<PerformanceMessage[]> {
        const memories = await this.getPerformanceMemories(roomId, {
            isLive: true,
            limit: count,
            sortDirection: 'desc',
            includeBeats: false
        });

        return memories.map(memory => ({
            speaker: memory.content.metadata.performance.lastSpeaker,
            text: memory.content.text,
            timestamp: memory.createdAt,
            actorNumber: memory.content.metadata.performance.actorNumber
        }));
    }

    /**
     * Gets all messages from a specific performance
     */
    async getFullPerformanceHistory(performanceId: string, roomId: UUID): Promise<Memory[]> {
        return await this.getPerformanceMemories(roomId, {
            performanceId,
            includeBeats: true,
            sortDirection: 'asc',
            limit: 100 // Adjust as needed
        });
    }

    /**
     * Creates a new memory with performance metadata
     */
    async createPerformanceMemory(memory: Memory & { content: PerformanceContent }): Promise<void> {
        if (!memory.content.metadata?.performance) {
            throw new Error('Performance metadata required');
        }

        await this.runtime.ensureConnection(
            memory.userId,
            memory.roomId,
            this.runtime.character.name,
            this.runtime.character.name,
            "performance"
        );

        await this.createMemory({
            ...memory,
            embedding: memory.embedding || embeddingZeroVector
        });
    }

    /**
     * Gets the last action time for a specific actor in the current performance
     */
    async getLastActorActionTime(roomId: UUID, actorNumber: number): Promise<number> {
        const memories = await this.getPerformanceMemories(roomId, {
            isLive: true,
            limit: 1,
            sortDirection: 'desc'
        });

        const lastMemory = memories.find(memory =>
            memory.content.metadata?.performance?.actorNumber === actorNumber
        );

        return lastMemory?.createdAt || 0;
    }

    /**
     * Checks if a specific actor can perform based on timing rules
     */
    async canActorPerform(roomId: UUID, actorNumber: number, minInterval: number): Promise<boolean> {
        const memories = await this.getMemories({
            roomId,
            count: 1,
            unique: false,
            agentId: this.runtime.agentId
        });

        if (!memories.length) return true;

        const lastAction = memories[0].createdAt || 0;
        return Date.now() - lastAction >= minInterval;
    }
}
