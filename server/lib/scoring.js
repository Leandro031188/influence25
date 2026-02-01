import { nanoid } from 'nanoid';

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function computeErScore(er) {
  if (er >= 0.06) return 100;
  if (er >= 0.03) return 70;
  if (er >= 0.015) return 45;
  return 20;
}

export function computeConsistencyScore(contentsPerWeek) {
  if (contentsPerWeek >= 4) return 100;
  if (contentsPerWeek >= 2) return 70;
  if (contentsPerWeek >= 1) return 40;
  return 20;
}

export function computeNicheScore(confidence) {
  if (confidence >= 0.75) return 100;
  if (confidence >= 0.6) return 75;
  if (confidence >= 0.45) return 55;
  return 35;
}

export function computeReachScore({ reachAvailable, ratio }) {
  if (!reachAvailable) return null;
  if (ratio >= 1.2) return 100;
  if (ratio >= 0.8) return 75;
  if (ratio >= 0.5) return 55;
  return 35;
}

export function computeFraudPenalty({ er, followers, contentCount30d }) {
  let p = 0;
  if (followers > 20000 && er < 0.008) p += 10;
  if (followers > 50000 && contentCount30d < 4) p += 10;
  if (er > 0.12 && contentCount30d < 6) p += 10;
  return clamp(p, 0, 30);
}

export function computeTotalScore({ erScore, reachScore, consistencyScore, nicheScore, fraudPenalty, reachAvailable }) {
  if (reachAvailable && typeof reachScore === 'number') {
    const total = 0.30*erScore + 0.25*reachScore + 0.20*consistencyScore + 0.15*nicheScore - 0.10*fraudPenalty;
    return clamp(Math.round(total), 0, 100);
  }
  const total = 0.40*erScore + 0.25*consistencyScore + 0.20*nicheScore - 0.15*fraudPenalty;
  return clamp(Math.round(total), 0, 100);
}

export function grade(score) {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  return 'C';
}

// --- Niche classifier (dictionary-based PT/ES)
const DICTS = {
  food: ["restaurante","sushi","comida","delivery","menú","menu","tapas","reseña","cocina","chef","hamburg","ramen","poke","izakaya"],
  beauty: ["maquillaje","skincare","uñas","estética","pelo","cabello","dermo","beauty","cosmética","cosmetica"],
  fitness: ["gym","treino","entreno","proteína","proteina","dieta","fitness","perder peso","pérdida","musculación","musculacion"],
  tech: ["apps","gadget","review","iphone","android","software","saas","tecnología","tecnologia","ai","ia"],
  family: ["mamá","mama","hijos","maternidad","familia","família","crianza","bebé","bebe","paternidad"],
  travel: ["viaje","viagem","travel","hotel","ruta","playa","aeropuerto","turismo","trip"],
  fashion: ["moda","outfit","look","streetwear","ropa","zapatos","fashion"]
};

export function classifyNiche({ bio = "", declared = "" }) {
  const text = (bio + " " + declared).toLowerCase();
  const scores = Object.fromEntries(Object.keys(DICTS).map(k => [k, 0]));
  const evidence = {};
  for (const [k, words] of Object.entries(DICTS)) {
    for (const w of words) {
      if (text.includes(w)) {
        scores[k] += 1;
        evidence[k] = evidence[k] || [];
        if (evidence[k].length < 8) evidence[k].push(w);
      }
    }
  }
  const ranked = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const [primary, pscore] = ranked[0];
  const [secondary, sscore] = ranked[1];
  const totalHits = ranked.reduce((sum, [,v]) => sum+v, 0) || 1;
  const confidence = pscore / totalHits;
  const primary_niche = pscore === 0 ? (declared ? "general" : "general") : primary;
  const secondary_niches = pscore === 0 ? [] : [secondary].filter(x => sscore>0);
  const evidence_keywords = (evidence[primary] || []).slice(0, 8);
  return {
    primary_niche,
    secondary_niches,
    confidence: Number(confidence.toFixed(2)),
    evidence_keywords
  };
}

// Brand target mapping (starter lists; replace with your own CRM list)
const BRAND_MAP = {
  food: {
    local: ["restaurantes locais","dark kitchens","cafés","eventos gastronômicos","apps de reservas"],
    ecommerce: ["utensílios de cozinha","assinatura gourmet","boxes de comida"]
  },
  beauty: {
    local: ["clínicas estéticas","salões","dermoclínicas"],
    ecommerce: ["skincare DTC","makeup","haircare"]
  },
  fitness: {
    local: ["academias","studios de treino","personal training"],
    ecommerce: ["roupa esportiva","acessórios fitness"]
  },
  tech: {
    local: ["assistência técnica","lojas de acessórios","coworkings"],
    ecommerce: ["gadgets","apps/SaaS","fintechs"]
  },
  family: {
    local: ["escolas/atividades","lojas infantis","serviços familiares"],
    ecommerce: ["produtos baby","brinquedos","assinaturas educativas"]
  },
  travel: {
    local: ["agências locais","tours","guias"],
    ecommerce: ["malas","acessórios viagem","seguros"]
  },
  fashion: {
    local: ["boutiques","barbearias/estilo","fotografia"],
    ecommerce: ["streetwear","acessórios","calçados"]
  },
  general: {
    local: ["serviços locais","eventos","restaurantes"],
    ecommerce: ["e-commerce geral","apps","produtos de alta rotatividade"]
  }
};

export function buildBrandTargets(niche) {
  const map = BRAND_MAP[niche] || BRAND_MAP.general;
  return {
    local: map.local,
    ecommerce: map.ecommerce
  };
}

export function id() { return nanoid(); }
