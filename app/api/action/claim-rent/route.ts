import {
    ACTIONS_CORS_HEADERS,
    ActionGetResponse,
    ActionPostRequest,
    ActionPostResponse,
    createPostResponse,
} from "@solana/actions";

import {
    Connection,
    PublicKey,
    Transaction,
    LAMPORTS_PER_SOL,
    SystemProgram,
} from "@solana/web3.js";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Function to check eligibility with Helius
async function checkEligibility(userKey: PublicKey): Promise<boolean> {
    console.log("Checking eligibility for user:", userKey.toString());

    try {
        const response = await fetch(`https://api.helius.xyz/v0/addresses/${userKey.toBase58()}/balances?api-key=${HELIUS_API_KEY}`);
        const data = await response.json();

        // Example conditions - adjust as needed
        const solBalance = data.nativeBalance / LAMPORTS_PER_SOL;
        const tokenBalance = data.tokens.find((token: { mint: string, amount: number }) => token.mint === 'your_token_mint_here')?.amount || 0;

        const isEligible = solBalance > 0.1 && tokenBalance > 0;
        console.log("Eligibility check result:", isEligible);
        return isEligible;
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error("Error checking eligibility:", error.message);
        }
        return false;
    }
}

// GET Request - Fetch metadata for the airdrop claim action
export async function GET(request: Request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    const validActions = ["claim"];
    console.log("GET request received. Action:", action);

    if (!action || !validActions.includes(action)) {
        console.error("Invalid or missing action parameter:", action);
        return Response.json({ error: "Invalid or missing parameters" }, {
            status: 400,
            headers: ACTIONS_CORS_HEADERS,
        });
    }

    const payload: ActionGetResponse = {
        icon: "https://example.com/airdrop-icon.png",
        title: "Claim Solana Airdrop",
        description: "Claim your Solana airdrop if you meet the eligibility criteria. Connect your wallet to check and claim.",
        label: "Claim Airdrop",
        links: {
            actions: [
                {
                    label: "Claim Airdrop",
                    href: `${url.origin}${url.pathname}?action=claim`,
                    type: "transaction"
                },
            ],
        },
    };

    console.log("GET request processed successfully. Payload:", payload);
    return Response.json(payload, {
        headers: ACTIONS_CORS_HEADERS,
    });
}

export const OPTIONS = GET;

// POST Request - Execute the airdrop claim transaction
export async function POST(request: Request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    console.log("POST request received. Action:", action);

    if (!action || action !== "claim") {
        console.error("Invalid action parameter:", action);
        return Response.json({ error: "Invalid parameters" }, {
            status: 400,
            headers: ACTIONS_CORS_HEADERS,
            statusText: "Invalid parameters",
        });
    }

    const body: ActionPostRequest = await request.json();

    let account: PublicKey;
    try {
        account = new PublicKey(body.account);
        console.log("User account parsed successfully:", account.toString());
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error("Invalid user account provided:", body.account, error.message);
        }
        return Response.json({ error: "Invalid account" }, {
            status: 400,
            headers: ACTIONS_CORS_HEADERS,
        });
    }

    const connection = new Connection(HELIUS_RPC_URL, "confirmed");

    try {
        // Check eligibility
        console.log("Checking eligibility...");
        const isEligible = await checkEligibility(account);

        if (!isEligible) {
            console.log("User is not eligible for the airdrop.");
            return Response.json({ error: "Not eligible for airdrop" }, {
                status: 400,
                headers: ACTIONS_CORS_HEADERS,
                statusText: "Not eligible for airdrop",
            });
        }

        // Create airdrop transaction
        console.log("Creating airdrop transaction...");
        const airdropAmount = 0.1 * LAMPORTS_PER_SOL; // Example: 0.1 SOL airdrop
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: account,
                toPubkey: account, // In a real scenario, this would be your airdrop distribution account
                lamports: airdropAmount,
            })
        );

        const blockheight = await connection.getLatestBlockhash();
        transaction.feePayer = account;
        transaction.recentBlockhash = blockheight.blockhash;
        transaction.lastValidBlockHeight = blockheight.lastValidBlockHeight;

        const payload: ActionPostResponse = await createPostResponse({
            fields: {
                transaction,
                message: `Airdrop claim transaction created for ${airdropAmount / LAMPORTS_PER_SOL} SOL.`,
                type: 'transaction',
            },
        });

        console.log("POST request processed successfully. Payload:", payload);

        return Response.json(payload, {
            headers: ACTIONS_CORS_HEADERS,
        });
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error("Error during POST request processing:", error.message);
            return Response.json({ error: `Failed to process airdrop claim: ${error.message}` }, {
                status: 500,
                headers: ACTIONS_CORS_HEADERS,
            });
        }
    }
}
