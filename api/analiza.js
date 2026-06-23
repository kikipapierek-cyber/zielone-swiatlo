// ============================================================================
// api/analiza.js — "Zielone Światło"
// Serverless (Vercel) — analiza kompletności dokumentacji projektu PV/BESS.
// Runtime: Node.js 18+ (wbudowany fetch). Składnia: CommonJS.
// Endpoint: POST /api/analiza
// Wejście:  { "text": "...", "typ_projektu": "pvbess" }
// Bez zależności npm.
// ============================================================================

// --- KONFIGURACJA MODELU ---------------------------------------------------
// UWAGA: llama-3.3-70b-versatile został wycofany przez Groq 17.06.2026 dla
// kont darmowych/dev. Domyślnie używamy rekomendowanego następcy.
// Aktualną listę modeli zweryfikuj: https://console.groq.com/docs/models
// Alternatywy open-weight bez "openai" w nazwie: "qwen/qwen3-32b" lub "qwen/qwen3.6-27b".
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// --- NAZWA MODELU POKAZYWANA W WYNIKU --------------------------------------
// Domyślnie pokazujemy model, który NAPRAWDĘ liczył (uczciwa proweniencja).
// Ten endpoint NIE liczy na Bieliku — liczy na Groq. Wpisanie tu
// "Bielik-11B-v2.6-Instruct" przy faktycznym wywołaniu Groq to fałszywa
// proweniencja modelu (ryzyko na obronie BZIK). Patrz opis pod kodem.
const MODEL_DISPLAY_NAME = process.env.MODEL_DISPLAY_NAME || GROQ_MODEL;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 25000;

// --- 15 KATEGORII (lista stała) --------------------------------------------
const KATEGORIE = [
  "Lokalizacja i opis terenu",
  "Dane techniczne instalacji PV",
  "Parametry systemu BESS",
  "Warunki przyłączenia OSD",
  "Analiza przyłączeniowa (symulacja przepływów mocy)",
  "Pozwolenie na budowę / decyzja WZ",
  "Ocena oddziaływania na środowisko (OOŚ)",
  "Raport geotechniczny",
  "Analiza nasłonecznienia (PVsyst lub równoważna)",
  "Kosztorys inwestycji (CAPEX/OPEX)",
  "Harmonogram realizacji",
  "Umowa dzierżawy / tytuł własności gruntu",
  "Plan zarządzania odpadami",
  "Certyfikaty urządzeń (CE/IEC)",
  "Analiza ekonomiczna (NPV, IRR, okres zwrotu)",
];

// --- DOMYŚLNE REKOMENDACJE -------------------------------------------------
// 10 pozycji dosłownie wg specyfikacji + 5 dopisanych (oznaczone), aby każda
// brakująca kategoria miała rekomendację (brak pustych pól w UI).
const DOMYSLNE_REKOMENDACJE = {
  // --- ze specyfikacji ---
  "Warunki przyłączenia OSD":
    "Złóż wniosek o warunki przyłączenia do właściwego OSD (ENERGA, TAURON, ENEA lub PGE Dystrybucja).",
  "Analiza przyłączeniowa (symulacja przepływów mocy)":
    "Wykonaj symulację przepływów mocy w PSCAD, PSS/E lub DigSILENT PowerFactory.",
  "Pozwolenie na budowę / decyzja WZ":
    "Uzyskaj decyzję o warunkach zabudowy lub pozwolenie na budowę w starostwie powiatowym.",
  "Ocena oddziaływania na środowisko (OOŚ)":
    "Przeprowadź ocenę oddziaływania na środowisko — wymagane dla instalacji powyżej 500 kW.",
  "Raport geotechniczny":
    "Zleć badania geotechniczne min. w 3 punktach na hektar terenu.",
  "Analiza nasłonecznienia (PVsyst lub równoważna)":
    "Wykonaj symulację produkcji energii w PVsyst lub PVWatts z danymi PVGIS.",
  "Umowa dzierżawy / tytuł własności gruntu":
    "Podpisz umowę dzierżawy gruntu lub udokumentuj tytuł własności.",
  "Plan zarządzania odpadami":
    "Opracuj plan gospodarki odpadami zgodnie z Ustawą o odpadach z 14.12.2012.",
  "Certyfikaty urządzeń (CE/IEC)":
    "Dostarcz certyfikaty CE, IEC 61215 (moduły), IEC 62109 (inwertery), IEC 62619 (BESS).",
  "Analiza ekonomiczna (NPV, IRR, okres zwrotu)":
    "Opracuj model finansowy z NPV, IRR i prostym okresem zwrotu.",
  // --- dopisane poza specyfikacją (ogólne) ---
  "Lokalizacja i opis terenu":
    "Dodaj opis działki: nr ewidencyjny, powierzchnię, ukształtowanie i obecne zagospodarowanie terenu.",
  "Dane techniczne instalacji PV":
    "Podaj moc DC/AC, typ i liczbę modułów oraz inwerterów i układ pól PV.",
  "Parametry systemu BESS":
    "Określ pojemność (kWh), moc (kW), technologię ogniw i tryb pracy magazynu.",
  "Kosztorys inwestycji (CAPEX/OPEX)":
    "Zestaw nakłady inwestycyjne (CAPEX) i koszty eksploatacji (OPEX) w rozbiciu na pozycje.",
  "Harmonogram realizacji":
    "Przedstaw harmonogram z etapami, terminami i kamieniami milowymi realizacji.",
};

// --- PROMPTY ---------------------------------------------------------------
const PROMPT_SYSTEMOWY =
  "Jesteś ekspertem od dokumentacji projektów OZE w Polsce (PV, BESS). " +
  "Analizujesz dokumenty pod kątem kompletności zgodnie z polskimi " +
  "wymaganiami prawnymi. Odpowiadasz WYŁĄCZNIE w formacie JSON, " +
  "bez komentarzy i bez markdown.";

function listaKategoriiTekst() {
  return KATEGORIE.map(function (k, i) {
    return i + 1 + ". " + k;
  }).join("\n");
}

function promptUzytkownika(dokument) {
  return (
    "Przeanalizuj poniższy dokument projektu OZE i sprawdź, które z 15 " +
    "kategorii dokumentacji PV/BESS są obecne, a których brakuje.\n\n" +
    "DOKUMENT:\n" +
    dokument +
    "\n\nSprawdź każdą z 15 kategorii:\n" +
    listaKategoriiTekst() +
    "\n\nJeśli informacje o kategorii są obecne (nawet częściowo) — uznaj " +
    "za obecną. Jeśli brak lub tylko wzmianka bez treści — brakująca. " +
    "Wyodrębnij nazwę projektu z dokumentu (lub 'Projekt PV/BESS' jeśli brak).\n\n" +
    "Zwróć DOKŁADNIE ten JSON (poprawny JSON, podwójne cudzysłowy, nazwy " +
    "kategorii dosłownie jak na liście powyżej):\n" +
    "{\n" +
    '  "project_name": "nazwa projektu",\n' +
    '  "present": ["pełna nazwa kategorii obecnej"],\n' +
    '  "missing": ["pełna nazwa kategorii brakującej"],\n' +
    '  "recommendations": {"pełna nazwa kategorii brakującej": "konkretna rekomendacja 1-2 zdania"}\n' +
    "}"
  );
}

// --- POMOCNICZE ------------------------------------------------------------
function normalizuj(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Próba 1: bezpośredni JSON.parse. Próba 2: wytnij od pierwszego { do ostatniego }.
function parsujJSON(tekst) {
  if (!tekst) return null;
  try {
    return JSON.parse(tekst);
  } catch (_) {}
  var start = tekst.indexOf("{");
  var end = tekst.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(tekst.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

// --- HANDLER ---------------------------------------------------------------
module.exports = async function (req, res) {
  // CORS na każdej odpowiedzi
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metoda niedozwolona. Użyj POST." });
    return;
  }

  // Klucz API
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Brak konfiguracji klucza API" });
    return;
  }

  // Body — Vercel zwykle parsuje JSON; zabezpieczamy też Buffer/string.
  let body = req.body;
  if (Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString("utf8")); } catch (_) { body = {}; }
  } else if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  if (!body || typeof body !== "object") body = {};

  const text = typeof body.text === "string" ? body.text : "";

  // Krok 1: walidacja długości
  if (text.trim().length < 50) {
    res.status(400).json({ error: "Dokument zbyt krótki do analizy" });
    return;
  }

  // Krok 2: przytnij do 8000 znaków
  const fragment = text.slice(0, 8000);

  // Krok 3: wywołanie Groq (timeout 25 s)
  const requestBody = {
    model: GROQ_MODEL,
    temperature: 0.3,
    max_completion_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROMPT_SYSTEMOWY },
      { role: "user", content: promptUzytkownika(fragment) },
    ],
  };
  // Modele rozumujące (GPT-OSS): ogranicz "myślenie", by tokeny nie zjadły JSON-a.
  if (GROQ_MODEL.indexOf("gpt-oss") !== -1) {
    requestBody.reasoning_effort = "low";
  }

  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, TIMEOUT_MS);

  let groqJson;
  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(function () { return ""; });
      res.status(502).json({
        error: "Błąd Groq API (HTTP " + groqRes.status + ")",
        szczegoly: errText.slice(0, 500),
      });
      return;
    }
    groqJson = await groqRes.json();
  } catch (e) {
    if (e && e.name === "AbortError") {
      res.status(504).json({ error: "Przekroczono limit czasu (25 s)" });
      return;
    }
    res.status(502).json({
      error: "Błąd połączenia z Groq: " + (e && e.message ? e.message : "nieznany"),
    });
    return;
  } finally {
    clearTimeout(timer);
  }

  // Krok 4: wyciągnij treść i sparsuj JSON
  const content =
    groqJson &&
    groqJson.choices &&
    groqJson.choices[0] &&
    groqJson.choices[0].message &&
    typeof groqJson.choices[0].message.content === "string"
      ? groqJson.choices[0].message.content
      : "";

  const parsed = parsujJSON(content);
  if (!parsed) {
    res.status(502).json({ error: "Nie udało się sparsować odpowiedzi modelu" });
    return;
  }

  // present = przecięcie odpowiedzi modelu z listą 15; missing = dopełnienie.
  // Gwarantuje present + missing = 15, bez duplikatów i śmieci spoza listy.
  const modelPresent = Array.isArray(parsed.present)
    ? parsed.present.map(normalizuj)
    : [];
  const present = KATEGORIE.filter(function (k) {
    return modelPresent.indexOf(normalizuj(k)) !== -1;
  });
  const presentSet = new Set(present);
  const missing = KATEGORIE.filter(function (k) {
    return !presentSet.has(k);
  });

  // Krok 5: score
  const score = Math.round((present.length / 15) * 100);

  // Krok 6: rekomendacje — z modelu, w razie braku domyślne.
  const modelRecsRaw =
    parsed.recommendations && typeof parsed.recommendations === "object"
      ? parsed.recommendations
      : {};
  const modelRecs = {};
  for (const klucz in modelRecsRaw) {
    if (Object.prototype.hasOwnProperty.call(modelRecsRaw, klucz)) {
      modelRecs[normalizuj(klucz)] = modelRecsRaw[klucz];
    }
  }

  const recommendations = {};
  for (let i = 0; i < missing.length; i++) {
    const kat = missing[i];
    const zModelu = modelRecs[normalizuj(kat)];
    if (typeof zModelu === "string" && zModelu.trim()) {
      recommendations[kat] = zModelu.trim();
    } else if (DOMYSLNE_REKOMENDACJE[kat]) {
      recommendations[kat] = DOMYSLNE_REKOMENDACJE[kat];
    } else {
      recommendations[kat] = "Uzupełnij brakującą sekcję dokumentacji: " + kat + ".";
    }
  }

  // project_name
  const projectName =
    typeof parsed.project_name === "string" && parsed.project_name.trim()
      ? parsed.project_name.trim()
      : "Projekt PV/BESS";

  // Krok 7: wynik
  const analysisDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  res.status(200).json({
    score: score,
    project_name: projectName,
    present: present,
    missing: missing,
    recommendations: recommendations,
    model: MODEL_DISPLAY_NAME,
    analysis_date: analysisDate,
  });
};
