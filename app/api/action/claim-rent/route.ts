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
} from "@solana/web3.js";

// Interface for token holdings
interface TokenHolding {
    mint: string;
    amount: string;
    decimals: number;
}

// Interface for airdrop criteria
interface AirdropCriteria {
    protocol: string;
    requiredTokens: string[];
    minimumBalance: number;
    minimumTransactions: number;
}

// Sample airdrop criteria - you can expand this
const AIRDROP_CRITERIA: AirdropCriteria[] = [
    {
        protocol: "JupiterV2",
        requiredTokens: ["JUPyiwrYJFskUPiHa7hkeR8VUtAAXxEDBtS1nHLApPf"],
        minimumBalance: 0,
        minimumTransactions: 5
    },
    {
        protocol: "Orca",
        requiredTokens: ["orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],
        minimumBalance: 0,
        minimumTransactions: 3
    }
];

// Function to fetch token holdings using Helius API
async function getTokenHoldings(address: string): Promise<TokenHolding[]> {
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
    const url = `https://api.helius.xyz/v0/addresses/${address}/balances?api-key=${HELIUS_API_KEY}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.tokens || [];
    } catch (error) {
        console.error("Error fetching token holdings:", error);
        return [];
    }
}

// Function to check DeFi protocol interactions using public RPC
async function checkDefiInteractions(
    connection: Connection,
    address: string,
    protocolAddresses: string[]
): Promise<Map<string, number>> {
    const interactions = new Map<string, number>();
    
    try {
        const signatures = await connection.getSignaturesForAddress(
            new PublicKey(address),
            { limit: 50 }
        );
        
        const transactions = await Promise.all(
            signatures.map(sig => connection.getTransaction(sig.signature))
        );

        for (const tx of transactions) {
            if (!tx) continue;
            
            const accounts = tx.transaction.message.accountKeys.map(key => key.toString());
            
            for (const protocolAddr of protocolAddresses) {
                if (accounts.includes(protocolAddr)) {
                    const count = interactions.get(protocolAddr) || 0;
                    interactions.set(protocolAddr, count + 1);
                }
            }
        }
    } catch (error) {
        console.error("Error checking DeFi interactions:", error);
    }
    
    return interactions;
}

// Function to check eligibility across protocols
async function checkAirdropEligibility(
    connection: Connection,
    userAddress: string
): Promise<{ eligible: boolean; protocol: string; reason: string }[]> {
    const results = [];
    const holdings = await getTokenHoldings(userAddress);
 
    for (const criteria of AIRDROP_CRITERIA) {
        const hasRequiredTokens = criteria.requiredTokens.some(token =>
            holdings.some(holding => holding.mint === token)
        );
        
        const interactions = await checkDefiInteractions(
            connection,
            userAddress,
            criteria.requiredTokens
        );
        
        const totalInteractions = Array.from(interactions.values())
            .reduce((sum, count) => sum + count, 0);

        let eligible = false;
        let reason = "";

        if (hasRequiredTokens && totalInteractions >= criteria.minimumTransactions) {
            eligible = true;
            reason = `Eligible for ${criteria.protocol} airdrop! Found ${totalInteractions} interactions.`;
        } else {
            reason = `Not eligible for ${criteria.protocol}. ` +
                `Need ${criteria.minimumTransactions} interactions, found ${totalInteractions}.`;
        }

        results.push({
            eligible,
            protocol: criteria.protocol,
            reason
        });
    }

    return results;
}

// GET endpoint
export async function GET(request: Request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (!action || action !== "check") {
        return Response.json({ error: "Invalid action" }, {
            status: 400,
            headers: ACTIONS_CORS_HEADERS,
        });
    }

    const payload: ActionGetResponse = {
        icon: "https://i.pinimg.com/originals/eb/23/cb/eb23cbe770fb90cc03171a56de61e17b.gif",
        title: "DeFi Airdrop Checker",
        description: "Check your eligibility for various DeFi protocol airdrops based on your on-chain activity",
        label: "Check Airdrops",
        links: {
            actions: [
                {
                    label: "Check Eligibility",
                    href: `${url.origin}${url.pathname}?action=check`,
                    type: "transaction",
                },
            ],
        },
    };

    return Response.json(payload, {
        headers: ACTIONS_CORS_HEADERS,
    });
}

export const OPTIONS = GET;

// POST endpoint
export async function POST(request: Request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (!action || action !== "check") {
        return Response.json({ error: "Invalid action" }, {
            status: 400,
            headers: ACTIONS_CORS_HEADERS,
        });
    }

    const body: ActionPostRequest = await request.json();
    
    try {
        const userAddress = body.account;
        if (!PublicKey.isOnCurve(new PublicKey(userAddress).toBuffer())) {
            throw new Error("Invalid Solana address");
        }
        
        const connection = new Connection(
            process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
            "confirmed"
        );

        console.log("Checking airdrops for address:", userAddress);

        const eligibilityResults = await checkAirdropEligibility(
            connection,
            userAddress
        );

        const eligibleAirdrops = eligibilityResults.filter(result => result.eligible);

        if (eligibleAirdrops.length === 0) {
            return Response.json({
                message: "No eligible airdrops found.\n" +
                    eligibilityResults.map(r => r.reason).join('\n')
            }, {
                headers: ACTIONS_CORS_HEADERS,
            });
        }

        // For demonstration, we'll create a mock transaction
        // In a real implementation, you'd create actual claim transactions
        const transaction = new Transaction();
        
        const payload: ActionPostResponse = await createPostResponse({
            fields: {
                transaction,
                message: `Found ${eligibleAirdrops.length} eligible airdrops:\n` +
                    eligibilityResults.map(r => r.reason).join('\n'),
                    type: 'transaction',
            },
        });

        return Response.json(payload, {
            headers: ACTIONS_CORS_HEADERS,
        });

    } catch (error) {
        console.error("Error processing airdrop check:", error);
        if (error instanceof Error) {
            return Response.json({
                error: `Failed to process airdrop check: ${error.message}`
            }, {
                status: 500,
                headers: ACTIONS_CORS_HEADERS,
            });
        } else {
            return Response.json({
                error: "An unknown error occurred while processing the airdrop check."
            }, {
                status: 500,
                headers: ACTIONS_CORS_HEADERS,
            });
        }
    }
}