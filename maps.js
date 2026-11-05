console.log("🧠 maps.js injected and running");

injectOverlayUI();
waitForInitialListings().then(() => {
  scrapeLeads(false).then(() => {
    enrichLeadsWithClickDetails();
  });
  startObservingNewListings();
});

// ===== UI Overlay =====

function injectOverlayUI() {
  if (document.getElementById('lead-overlay-ui')) return;

  const overlay = document.createElement('div');
  overlay.id = 'lead-overlay-ui';
  overlay.innerHTML = `
    <div style="
      position: fixed; top: 20px; right: 20px;
      background: linear-gradient(180deg,#1E1813,#14100C);
      border: 1px solid #33291F; border-left: 3px solid #C8622A;
      border-radius: 6px; padding: 16px 18px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.5);
      z-index: 999999; font-family: 'Inter',system-ui,sans-serif;
      color: #EDE4D8; width: 250px;
    ">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px;">
        <div style="width:20px;height:20px;border-radius:50%;border:1.5px solid #6E4A32;position:relative;overflow:hidden;">
          <div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(200,98,42,.6),transparent 60%);animation:pr-sweep 3s linear infinite;"></div>
          <div style="position:absolute;top:50%;left:50%;width:3px;height:3px;margin:-1.5px;border-radius:50%;background:#C8622A;box-shadow:0 0 5px #C8622A;"></div>
        </div>
        <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:13px;letter-spacing:.14em;text-transform:uppercase;">PROSPECT<span style="color:#C8622A;"> RADAR</span></div>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.18em;color:#8A7A68;text-transform:uppercase;margin-bottom:4px;">Listings Acquired</div>
      <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:34px;line-height:1;color:#C8622A;margin-bottom:14px;" id="lead-count">0</div>
      <div style="display:flex;gap:8px;">
        <button id="start-over-btn" style="
          flex:1;padding:9px 10px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;
          background:transparent;color:#8A7A68;border:1px solid #33291F;border-radius:4px;cursor:pointer;
        ">Reset</button>
        <button id="done-btn" style="
          flex:2;padding:9px 10px;font-family:'Oswald',sans-serif;font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase;
          background:#C8622A;color:#14100C;border:none;border-radius:4px;cursor:pointer;
        ">Lock Targets</button>
      </div>
    </div>
  `;
  if (!document.getElementById('pr-overlay-style')) {
    const st = document.createElement('style');
    st.id = 'pr-overlay-style';
    st.textContent = '@keyframes pr-sweep{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
  document.body.appendChild(overlay);


  document.getElementById("start-over-btn").addEventListener("click", () => {
    console.log("Start over pressed")
    localStorage.removeItem("leads");
    //scrapeLeads(false);
    // Also notify background to close this tab and go back to popup
    chrome.runtime.sendMessage({ action: "resetAndReturn" });
  });

  document.getElementById('done-btn').addEventListener('click', () => {
    const leads = JSON.parse(localStorage.getItem("leads") || "[]");
    chrome.storage.local.set({ leads }, () => {
      chrome.runtime.sendMessage({ action: 'doneCollecting' });
    });
  });
}

function updateLeadCount(n) {
  const counter = document.getElementById("lead-count");
  if (counter) counter.textContent = n;
}

// ===== Scraping Logic =====

function waitForInitialListings() {
  return new Promise(resolve => {
    const check = () => {
      const cards = document.querySelectorAll('div[role="article"], div.Nv2PK');
      if (cards.length > 0) {
        console.log(`🧱 Initial cards found: ${cards.length}`);
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

function getGoogleMapsTypeLabel(container) {
  if (!container) return "";

  // Google Maps commonly uses this for the clickable category
  const categoryButton = container.querySelector("button.DkEaL");
  if (categoryButton?.innerText?.trim()) {
    return categoryButton.innerText.trim();
  }

  // Fallback: buttons that reference category-related actions
  const buttons = Array.from(container.querySelectorAll("button"));

  const categoryCandidate = buttons.find(btn => {
    const text = btn.innerText?.trim();
    const jsaction = btn.getAttribute("jsaction") || "";
    const ariaLabel = btn.getAttribute("aria-label") || "";

    return (
      text &&
      (
        jsaction.toLowerCase().includes("category") ||
        ariaLabel.toLowerCase().includes("category")
      )
    );
  });

  if (categoryCandidate) {
    return categoryCandidate.innerText.trim();
  }

  return "";
}

async function scrapeLeads(merge = false) {
  const cards = document.querySelectorAll('div[role="article"], div.Nv2PK');
  const newLeads = [];

  for (const card of cards) {
    const name = card.querySelector("div.qBF1Pd")?.innerText?.split("\n")[0] || "Unnamed";
    const profile = card.querySelector("a.hfpxzc")?.href || "";
    const website = Array.from(card.querySelectorAll("a")).find(a => a.innerText.toLowerCase().includes("website"))?.href || "";
    const phone = card.querySelector("span.UsdlK")?.innerText || "";

    // ===== Rating + review count for qualification =====
    // Rating shows as an aria-label like "4.6 stars 123 Reviews" on a span, and the review
    // count often sits in a span like "(123)". Grab both defensively from several shapes.
    let rating = "";
    let reviews = "";

    // Strategy A: aria-label on the star/rating element
    const ariaEl = card.querySelector('span[role="img"][aria-label*="star" i], span[aria-label*="star" i]');
    if (ariaEl) {
      const al = ariaEl.getAttribute("aria-label") || "";
      const rMatch = al.match(/([0-9]+[.,][0-9]+)/);
      if (rMatch) rating = rMatch[1].replace(",", ".");
      const cMatch = al.match(/([0-9][0-9.,]*)\s*review/i);
      if (cMatch) reviews = cMatch[1].replace(/[.,]/g, "");
    }

    // Strategy B: explicit rating span (MW4etd) and review-count span (UY7F9)
    if (!rating) {
      const rEl = card.querySelector("span.MW4etd");
      if (rEl) rating = (rEl.innerText || "").trim().replace(",", ".");
    }
    if (!reviews) {
      const cEl = card.querySelector("span.UY7F9");
      if (cEl) {
        const m = (cEl.innerText || "").match(/([0-9][0-9.,]*)/);
        if (m) reviews = m[1].replace(/[.,]/g, "");
      }
    }

    // Normalize to numbers or empty
    rating = rating && !isNaN(parseFloat(rating)) ? parseFloat(rating) : "";
    reviews = reviews && !isNaN(parseInt(reviews, 10)) ? parseInt(reviews, 10) : "";

    newLeads.push({ name, profile, website, phone, rating, reviews, googleMapsTypeLabel: "" });
  }

  if (merge) {
    const existing = JSON.parse(localStorage.getItem("leads") || "[]");
    const combined = [...existing];

    for (const lead of newLeads) {
      if (!existing.some(e => e.name === lead.name && e.phone === lead.phone)) {
        combined.push(lead);
      }
    }

    localStorage.setItem("leads", JSON.stringify(combined));
    updateLeadCount(combined.length);
    console.log(`➕ Merged new leads — total now ${combined.length}`);
  } else {
    localStorage.setItem("leads", JSON.stringify(newLeads));
    updateLeadCount(newLeads.length);
    console.log(`✅ Initial scrape — found ${newLeads.length} leads`);
  }

  chrome.runtime.sendMessage({ type: "leadsUpdated" });
}

// ===== Auto-Click Listings for More Info =====

async function enrichLeadsWithClickDetails() {
  const cards = Array.from(
    document.querySelectorAll('div[role="article"], div.Nv2PK')
  );

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    const existingLeads = JSON.parse(
      localStorage.getItem("leads") || "[]"
    );

    const lead = existingLeads[i];

    if (!lead) continue;

    // Skip only when ALL enrichment data already exists
    if (
      lead.website &&
      lead.phone &&
      lead.googleMapsTypeLabel
    ) {
      continue;
    }

    // Open listing
    card.click();

    console.log(`🖱️ Clicked ${lead.name} for enrichment`);

    await new Promise(r => setTimeout(r, 2000));

    // Find Google Maps details panel
    const sidebar = document.querySelector('div[role="region"]');

    if (sidebar) {

      // ===== Website =====
      const website =
        Array.from(sidebar.querySelectorAll("a"))
          .find(a =>
            a.innerText
              ?.toLowerCase()
              .includes("website")
          )?.href || "";


      // ===== Phone =====
      const phone =
        Array.from(sidebar.querySelectorAll("span"))
          .find(s =>
            s.innerText?.match(
              /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
            )
          )?.innerText || "";


      // ===== Google Maps Type Label =====
      const googleMapsTypeLabel =
        getGoogleMapsTypeLabel(sidebar);


      lead.website =
        lead.website || website;

      lead.phone =
        lead.phone || phone;

      lead.googleMapsTypeLabel =
        lead.googleMapsTypeLabel || googleMapsTypeLabel;


      console.log(
        `🏷️ ${lead.name} → ${lead.googleMapsTypeLabel || "No type found"}`
      );


      localStorage.setItem(
        "leads",
        JSON.stringify(existingLeads)
      );

      updateLeadCount(existingLeads.length);
    }
  }

  console.log("🧼 Enrichment complete");

  chrome.runtime.sendMessage({
    type: "leadsUpdated"
  });
}

// ===== Detect New Listings on Scroll =====

function startObservingNewListings() {
  const feed = document.querySelector('[role="feed"]');
  if (!feed) {
    console.warn("❌ No feed container found to observe.");
    return;
  }

  const observer = new MutationObserver(() => {
    console.log("📦 New listings added — re-scraping...");
    scrapeLeads(true);
  });

  observer.observe(feed, { childList: true, subtree: true });
}
