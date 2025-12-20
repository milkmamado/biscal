import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MarketData {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  volatility: number;
  adx: number;
  rsi: number;
  bbWidth: number;
  ema8: number;
  ema21: number;
  macdHistogram: number;
  recentTrades?: { pnl: number; symbol: string; side: string }[];
}

interface MarketAnalysis {
  marketCondition: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'QUIET';
  confidence: number;
  recommendation: 'AGGRESSIVE' | 'NORMAL' | 'CONSERVATIVE' | 'STOP';
  adjustments: {
    tpMultiplier: number;
    slMultiplier: number;
    minConfidence: number;
    entryDelay: number;
  };
  reasoning: string;
  warnings: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { marketData } = await req.json() as { marketData: MarketData };
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`[analyze-market] Analyzing ${marketData.symbol} - ADX: ${marketData.adx}, RSI: ${marketData.rsi}`);

    const systemPrompt = `You are an expert crypto scalping market analyst. Analyze the given market data and provide trading recommendations.

Your task:
1. Determine the current market condition (TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE, QUIET)
2. Provide a trading recommendation (AGGRESSIVE, NORMAL, CONSERVATIVE, STOP)
3. Suggest parameter adjustments for the trading bot

Rules for analysis:
- ADX < 20: Ranging/Quiet market - be conservative or stop
- ADX 20-40: Normal trend - normal trading
- ADX > 40: Strong trend - can be aggressive if direction is clear
- RSI < 30 or > 70: Oversold/Overbought - potential reversal
- BB Width < 2%: Low volatility - reduce position size
- BB Width > 5%: High volatility - widen stops
- Consecutive losses: Reduce confidence threshold

Respond ONLY with a valid JSON object (no markdown, no code blocks):
{
  "marketCondition": "TRENDING_UP|TRENDING_DOWN|RANGING|VOLATILE|QUIET",
  "confidence": 0-100,
  "recommendation": "AGGRESSIVE|NORMAL|CONSERVATIVE|STOP",
  "adjustments": {
    "tpMultiplier": 0.5-2.0,
    "slMultiplier": 0.5-2.0,
    "minConfidence": 50-90,
    "entryDelay": 0-30
  },
  "reasoning": "brief explanation",
  "warnings": ["array of warnings if any"]
}`;

    const userPrompt = `Analyze this market data for ${marketData.symbol}:
- Current Price: $${marketData.price}
- 24h Change: ${marketData.priceChange24h.toFixed(2)}%
- 24h Volume: $${(marketData.volume24h / 1_000_000).toFixed(1)}M
- Volatility (BB Width): ${marketData.volatility.toFixed(2)}%
- ADX: ${marketData.adx.toFixed(1)}
- RSI: ${marketData.rsi.toFixed(1)}
- EMA8 vs EMA21: ${marketData.ema8 > marketData.ema21 ? 'Bullish' : 'Bearish'} (${(((marketData.ema8 - marketData.ema21) / marketData.ema21) * 100).toFixed(3)}%)
- MACD Histogram: ${marketData.macdHistogram > 0 ? 'Positive' : 'Negative'}
${marketData.recentTrades ? `- Recent ${marketData.recentTrades.length} trades: ${marketData.recentTrades.filter(t => t.pnl > 0).length} wins, ${marketData.recentTrades.filter(t => t.pnl <= 0).length} losses` : ''}

Provide your analysis as JSON.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error("[analyze-market] Rate limited");
        return new Response(JSON.stringify({ 
          error: "Rate limited", 
          fallback: getDefaultAnalysis(marketData) 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        console.error("[analyze-market] Payment required");
        return new Response(JSON.stringify({ 
          error: "Payment required", 
          fallback: getDefaultAnalysis(marketData) 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("[analyze-market] AI error:", response.status, errorText);
      return new Response(JSON.stringify({ 
        error: "AI analysis failed", 
        fallback: getDefaultAnalysis(marketData) 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("[analyze-market] No content in response");
      return new Response(JSON.stringify({ 
        analysis: getDefaultAnalysis(marketData) 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the JSON response
    let analysis: MarketAnalysis;
    try {
      // Remove any markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanContent);
      console.log(`[analyze-market] AI Analysis: ${analysis.marketCondition} - ${analysis.recommendation}`);
    } catch (parseError) {
      console.error("[analyze-market] Failed to parse AI response:", content);
      analysis = getDefaultAnalysis(marketData);
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[analyze-market] Error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
      fallback: {
        marketCondition: 'RANGING',
        confidence: 50,
        recommendation: 'CONSERVATIVE',
        adjustments: { tpMultiplier: 1.0, slMultiplier: 1.0, minConfidence: 70, entryDelay: 5 },
        reasoning: 'Fallback due to error',
        warnings: ['Analysis failed, using default settings']
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Default analysis based on simple rules
function getDefaultAnalysis(data: MarketData): MarketAnalysis {
  const { adx, rsi, volatility, ema8, ema21 } = data;
  
  let marketCondition: MarketAnalysis['marketCondition'] = 'RANGING';
  let recommendation: MarketAnalysis['recommendation'] = 'NORMAL';
  let confidence = 60;
  const warnings: string[] = [];
  
  // Determine market condition
  if (adx < 20) {
    marketCondition = volatility < 2 ? 'QUIET' : 'RANGING';
    recommendation = 'CONSERVATIVE';
    confidence = 40;
    warnings.push('Low ADX indicates weak trend');
  } else if (adx > 40) {
    marketCondition = ema8 > ema21 ? 'TRENDING_UP' : 'TRENDING_DOWN';
    recommendation = 'AGGRESSIVE';
    confidence = 80;
  } else {
    if (volatility > 5) {
      marketCondition = 'VOLATILE';
      recommendation = 'CONSERVATIVE';
      warnings.push('High volatility - widen stops');
    } else {
      marketCondition = ema8 > ema21 ? 'TRENDING_UP' : 'TRENDING_DOWN';
      recommendation = 'NORMAL';
      confidence = 65;
    }
  }
  
  // RSI extremes
  if (rsi < 25 || rsi > 75) {
    warnings.push(`RSI ${rsi.toFixed(1)} - potential reversal zone`);
    confidence = Math.max(confidence - 15, 30);
  }
  
  // Calculate adjustments
  const tpMultiplier = adx > 35 ? 1.3 : adx < 20 ? 0.7 : 1.0;
  const slMultiplier = volatility > 4 ? 1.3 : volatility < 2 ? 0.8 : 1.0;
  const minConfidence = adx < 25 ? 75 : 65;
  const entryDelay = adx < 20 ? 10 : 0;
  
  return {
    marketCondition,
    confidence,
    recommendation,
    adjustments: {
      tpMultiplier,
      slMultiplier,
      minConfidence,
      entryDelay,
    },
    reasoning: `ADX ${adx.toFixed(1)}, RSI ${rsi.toFixed(1)}, Vol ${volatility.toFixed(2)}%`,
    warnings,
  };
}
