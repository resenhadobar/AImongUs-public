import express from 'express';
import bodyParser from 'body-parser';
import {IAgentRuntime} from '@ai16z/eliza/src/types.ts';
import {verifyMessage} from "./utils/signingUtils.ts";
import {generateText, ModelClass} from "@ai16z/eliza";

export class FxnClientInterface {
    private app: express.Express;

    constructor(private runtime: IAgentRuntime) {
        this.app = express();
        this.app.use(bodyParser.json());

        const role = this.runtime.getSetting("FXN_ROLE");
        console.log('FXN Role is ', role);
        if (role) {
            this.setupGame(role);
        }
    }

    private setupGame(role: string) {
        if (role === 'PLAYER') {
            this.setupRoutes();
            const port = this.runtime.getSetting("SERVER_PORT") || 3000;
            this.app.listen(port, () => {
                console.log(`Player server running on port ${port}`);
            });
        } else {
            console.log('Non-player role detected, skipping setup');
        }
    }

    private setupRoutes() {
        console.log('Setting up routes for player');
        const handleRequest = async (req: any, res: any) => {
            try {
                const { publicKey, signature, payload } = req.body;
        
                console.log('Received POST request:', {
                    path: req.path,
                    body: req.body,
                    headers: req.headers
                });
        
                if (!payload || !payload.gameState) {
                    console.error('Invalid payload structure:', payload);
                    return res.status(400).json({
                        error: 'Invalid payload',
                        details: 'Missing gameState'
                    });
                }
        
                console.log('Game state is:', JSON.stringify(payload.gameState, null, 2));
        
                const gameMasterKey = this.runtime.getSetting("GAME_MASTER_KEY");
        
                const verificationResult = await verifyMessage({
                    payload,
                    signature,
                    publicKey: gameMasterKey
                });
        
                if (!verificationResult.isValid) {
                    console.error('Signature verification failed');
                    return res.status(401).json({
                        error: 'Invalid signature',
                        details: 'Message signature verification failed'
                    });
                }
        
                console.log('Processing game state phase:', payload.gameState.phase);
                const decision = await this.handleGameState(payload.gameState);
                console.log('Generated decision:', decision);
        
                // Send response
                console.log('Sending response:', decision);
                return res.json(decision);
        
            } catch (error) {
                console.error('Error processing request:', error);
                // Return pass on error as a safe fallback
                return res.status(200).json({ type: 'pass' });
            }
        };

        this.app.post('/', handleRequest);
        this.app.post('', handleRequest);
    }

    private createActionPrompt(gameState: any): string {
        const isImpostor = gameState.yourRole.type === 'impostor';
        const playersInRoom = gameState.players.filter(
            (p: any) => p.room === gameState.yourRole.room && 
            p.isAlive && 
            p.publicKey !== gameState.publicKey &&
            (isImpostor ? !p.role || p.role !== 'impostor' : true)
        );
    
        const deadBodiesInRoom = gameState.players.filter(
            (p: any) => p.room === gameState.yourRole.room && 
            !p.isAlive &&
            !p.deathInfo?.reported &&
            p.deathInfo?.type === 'killed'
        );
    
        const eventInRoom = gameState.activeEvents?.find(
            (e: any) => e.room === gameState.yourRole.room && !e.fixingPlayer
        );
    
        if (gameState.fixingEvent) {
            return `You are currently fixing an emergency (${gameState.fixingRoundsLeft} rounds remaining).
    You cannot take any other actions.
    First explain why you must continue fixing, then respond with: "fixing"`;
        }
    
        let prompt = `You are playing Among Us as a ${isImpostor ? 'IMPOSTOR' : 'crewmate'}.
    Round ${gameState.currentRound}/${gameState.maxRounds}
    
    Current situation:
    - You are in room ${gameState.yourRole.room}
    - Players in your room: ${playersInRoom.map((p: any) => p.publicKey).join(', ')}
    ${deadBodiesInRoom.length > 0 ? `- Dead bodies in room: ${deadBodiesInRoom.map(p => p.publicKey).join(', ')}` : ''}
    ${eventInRoom ? '- There is an active emergency in this room!' : ''}
    
    ${isImpostor ? 
    `As an impostor:
    - Your goal is to kill crewmates
    - You can kill anyone in your room who is not an impostor
    - You can report bodies to create chaos
    - Never fix emergencies!` :
    `As a crewmate:
    - Your goal is to fix emergencies and identify impostors
    - Report any bodies you find
    - Stay alive and work together with other crewmates`}
    
    Analyze the situation and explain your reasoning for what action you will take.
    Then on a new line, respond with exactly one of:
    ${deadBodiesInRoom.length > 0 ? '- "report" to report a body' : ''}
    ${!isImpostor && eventInRoom ? '- "fix" to start fixing the emergency' : ''}
    ${isImpostor && playersInRoom.length > 0 ? '- "kill {playerKey}" to kill someone in your room' : ''}
    - "pass" to do nothing this round`;
        
        return prompt;
    }

    private createMovementPrompt(gameState: any): string {
        const isImpostor = gameState.yourRole.type === 'impostor';
        const currentRoom = gameState.yourRole.room;
    
        if (gameState.fixingEvent) {
            return `You are currently fixing an emergency (${gameState.fixingRoundsLeft} rounds remaining).
    You cannot move.
    Explain why you must stay, then respond with: "stay"`;
        }
    
        const roomInfo = Array(6).fill(0).map((_,i) => {
            const playersInRoom = gameState.players.filter((p: any) => 
                p.isAlive && p.room === i &&
                p.publicKey !== gameState.publicKey
            );
            const events = gameState.activeEvents.filter(e => e.room === i);
            return {
                room: i,
                players: playersInRoom.map(p => p.publicKey),
                events: events.length
            };
        });
    
        let prompt = `You are playing Among Us as a ${isImpostor ? 'IMPOSTOR' : 'crewmate'}.
    Round ${gameState.currentRound}/${gameState.maxRounds}
    
    Current situation:
    - You are in room ${currentRoom}
    - Adjacent rooms:
      - Clockwise: Room ${(currentRoom + 1) % 6} (${roomInfo[(currentRoom + 1) % 6].players.length} players)
      - Counterclockwise: Room ${(currentRoom + 5) % 6} (${roomInfo[(currentRoom + 5) % 6].players.length} players)
    
    ${isImpostor ? 
    `As an impostor:
    - Look for isolated targets
    - Avoid large groups unless you want to blend in
    - Position yourself for future kills` :
    `As a crewmate:
    - Stay with groups when possible
    - Move towards emergencies that need fixing
    - Avoid being alone with potential impostors`}
    
    Analyze the situation and explain your movement strategy.
    Then on a new line, respond with exactly one of:
    - "stay" to remain in your current room
    - "clockwise" to move to the next room
    - "counterclockwise" to move to the previous room`;
    
        return prompt;
    }

    private createVotingPrompt(gameState: any): string {
        const isImpostor = gameState.yourRole.type === 'impostor';
        const reportedBody = gameState.reportedBody;
        const reporter = gameState.reporter;
        const deadPlayer = gameState.players.find(p => p.publicKey === reportedBody);
        const alivePlayers = gameState.players.filter(p => p.isAlive);
        const myPublicKey = gameState.publicKey;
    
        let prompt = `You are playing Among Us as a ${isImpostor ? 'IMPOSTOR' : 'crewmate'}.
    Your public key is: ${myPublicKey}
    A dead body has been reported!
    
    Situation:
    - Body: ${reportedBody}
    - Reported by: ${reporter}
    - Found in room: ${deadPlayer?.room}
    - Living players and their locations:
    ${alivePlayers.map(p => `  - ${p.publicKey}${p.publicKey === myPublicKey ? ' (You)' : ''} in room ${p.room}`).join('\n')}
    
    ${gameState.votingMessages?.length ? 
    `Current voting discussion:
    ${gameState.votingMessages.map(m => 
        `- ${m.playerKey}${m.playerKey === myPublicKey ? ' (You)' : ''} voted for ${m.target || 'skip'}: ${m.reason}`
    ).join('\n')}
    
    Consider the votes and reasoning from other players above. Analyze any patterns or inconsistencies in their statements.` : 
    'No votes have been cast yet.'}
    
    ${isImpostor ? 
    `As an impostor:
    - Consider how other players have voted and use their reasoning to your advantage
    - Try to deflect suspicion
    - Consider whether to support existing accusations or create new ones
    - Vote strategically based on the discussion` : 
    `As a crewmate:
    - Analyze the voting patterns and arguments made by others
    - Look for contradictions in player statements
    - Consider who has been most/least active in discussion
    - Look for suspicious voting patterns
    - Pay special attention to how players near the body have voted`}
    
    Remember: You are ${myPublicKey}. Analyze all statements made so far and explain your voting decision.
    Then on a new line, respond in exactly this format:
    "{target} | {reason}"
    (use "skip" as target to skip voting)`;
    
        return prompt;
    }

    private validateAction(action: string, target: string, gameState: any): boolean {
        if (gameState.fixingEvent) {
            return action === 'fixing';
        }
    
        if (target === gameState.publicKey) {
            console.log('Invalid: Self-targeting detected');
            return false;
        }
    
        if (action === 'kill') {
            const targetPlayer = gameState.players.find((p: any) => p.publicKey === target);
            if (targetPlayer?.role === 'impostor') {
                console.log('Invalid: Attempted to kill another impostor');
                return false;
            }
    
            if (!gameState.players.some((p: any) => 
                p.publicKey === target && 
                p.room === gameState.yourRole.room &&
                p.isAlive
            )) {
                console.log('Invalid: Target not in same room or not alive');
                return false;
            }
        }
    
        if (action === 'fix') {
            const eventInRoom = gameState.activeEvents?.find(
                (e: any) => e.room === gameState.yourRole.room &&
                !e.fixingPlayer
            );
            if (!eventInRoom) {
                console.log('Invalid: No event to fix in current room');
                return false;
            }
        }
    
        return true;
    }

    private async handleGameState(gameState: any): Promise<any> {
        if (!gameState) {
            console.error('Received null or undefined gameState');
            return { type: 'pass' };
        }

        console.log('Processing game state:', {
            phase: gameState.phase,
            round: gameState.currentRound,
            role: gameState.yourRole?.type,
            room: gameState.yourRole?.room,
            publicKey: gameState.publicKey
        });
        
        // Check for winner first
        if (gameState.winner || gameState.phase === 'dead') {
            console.log(gameState.winner ? `Game is over! Winner: ${gameState.winner}` : 'Player is dead');
            return {};
        }
    
        try {
            switch (gameState.phase) {
                case 'action': {
                    console.log('Generating action decision...');
                    const actionResponse = await generateText({
                        runtime: this.runtime,
                        context: this.createActionPrompt(gameState),
                        modelClass: ModelClass.SMALL
                    });
        
                    console.log('Generated action response:', actionResponse);
                    const lines = actionResponse.split('\n');
                    const actionLine = lines[lines.length - 1].trim();
        
                    if (actionLine === 'fixing') return { type: 'fixing' };
                    if (actionLine === 'pass') return { type: 'pass' };
                    if (actionLine === 'report') return { type: 'report' };
                    if (actionLine === 'fix') return { type: 'fix' };
                    
                    const [action, target] = actionLine.split(' ');
                    if (!this.validateAction(action, target, gameState)) {
                        return { type: 'pass' };
                    }
                    return { type: action, target };
                }
        
                case 'movement': {
                    console.log('Generating movement decision...');
                    const response = await generateText({
                        runtime: this.runtime,
                        context: this.createMovementPrompt(gameState),
                        modelClass: ModelClass.SMALL
                    });
                    
                    console.log('Generated movement response:', response);
                    const lines = response.split('\n');
                    const movement = lines[lines.length - 1].trim();
                    return { type: movement.toLowerCase() };
                }
        
                case 'voting': {
                    if (gameState.currentVoter !== gameState.publicKey) {
                        console.log('Not our turn to vote, returning empty object');
                        return {};
                    }
        
                    console.log('Generating voting decision...');
                    const response = await generateText({
                        runtime: this.runtime,
                        context: this.createVotingPrompt(gameState),
                        modelClass: ModelClass.SMALL
                    });
                    
                    console.log('Generated voting response:', response);
                    const lines = response.split('\n');
                    const voteLine = lines[lines.length - 1].trim();
                    const [target, reason] = voteLine.split(' | ').map(s => s.trim());
        
                    return {
                        target: target.toLowerCase() === 'skip' ? 'skip' : target,
                        voteText: reason || 'No reason provided'
                    };
                }
        
                default: {
                    console.warn(`Unknown game phase: ${gameState.phase}, returning empty object`);
                    return {};
                }
            }
        } catch (error) {
            console.error('Error in handleGameState:', error);
            console.error('Error stack:', error.stack);
            return { type: 'pass' }; // Safe fallback
        }
    }


    static async start(runtime: IAgentRuntime) {
        console.log('Starting FXN Client');
        return new FxnClientInterface(runtime);
    }

    async stop() {
        console.log('Stopping client');
    }
}