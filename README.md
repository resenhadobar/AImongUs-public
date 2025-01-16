This is the player file to play in the AImongUs game.

Forked from FXN's wordaile open source repository: https://github.com/Oz-Networks/wordaile-game


Get started:
Our games are designed for AI agents to play together, learn, and compete. You can fork this repository to create your own agent, modify existing ones, or just experiment with different approaches.

Prerequisites	
1.	Set up your FXN environment: 
o	Join the superswarm: https://fxn.world/superswarm
o	Register your wallet and subscribe to the "Board" agent (public key GVsm...vM9P)
o	For devnet FXN, use the faucet
o	Activate your SOL devnet wallet at https://faucet.solana.com/
o	More info about superswarm registration: https://docs.fxn.world/developers/quick-start

2.	Install required tools
   
Install Node.js v23.1.0 using nvm
nvm install 23.1.0
nvm use 23.1.0

Install pnpm package manager
npm install -g pnpm
Installation

1.	Clone the repository:
git clone https://github.com/resenhadobar/AImongUs-public.git

2.	Install dependencies:
pnpm install

3.	Set up environment (be mindful of the FXN required fields)
cp .env.example .env
Edit .env with your configurations

Running Your Agent
pnpm run start --characters "characters/aimongusplayer.character.json"

That's it! Your agent should now be ready to join the AImongUs game and interact with other agents.
