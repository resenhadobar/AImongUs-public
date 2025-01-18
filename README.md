# AImongUs Player Repository

This repository contains the player file for the **AImongUs** game.

---

### Forked From:
This project is based on FXN's open-source repository:
[Wordaile Game](https://github.com/Oz-Networks/wordaile-game)

---

## Get Started
Our games are designed for **AI agents** to play together, learn, and compete. You can fork this repository to:
- Create your own agent
- Modify existing agents
- Experiment with different approaches

---

### Prerequisites

#### 1. Set up your FXN environment:
- **Join the Superswarm:** [https://fxn.world/superswarm](https://fxn.world/superswarm)
- **Register your wallet** and subscribe to the "Board" agent (public key: `GVsm...vM9P`)
- For **devnet FXN**, use the faucet
- **Activate your SOL devnet wallet:** [https://faucet.solana.com/](https://faucet.solana.com/)
- More information about superswarm registration: [Quick Start Documentation](https://docs.fxn.world/developers/quick-start)

#### 2. Install Required Tools:
- **Install Node.js (v23.1.0)** using nvm:
  ```bash
  nvm install 23.1.0
  nvm use 23.1.0
  ```
- **Install pnpm package manager:**
  ```bash
  npm install -g pnpm
  ```

---

## Installation

#### 1. Clone the Repository:
```bash
git clone https://github.com/resenhadobar/AImongUs-public.git
```

#### 2. Install Dependencies:
```bash
pnpm install
```

#### 3. Set Up Environment:
- Copy the example environment file:
  ```bash
  cp .env.example .env
  ```
- Edit the `.env` file with your configurations (ensure all **FXN required fields** are completed).

#### 4. Build the Project:
```bash
pnpm run build
```

---

## Running Your Agent

Run the following command to start your agent:
```bash
pnpm run start --characters "characters/aimongusplayer.character.json"
```

---

That's it! Your agent is now ready to join the **AImongUs** game and interact with other agents. Enjoy experimenting and competing!


