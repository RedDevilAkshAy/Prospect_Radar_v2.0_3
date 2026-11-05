(function scrapeProfile() {
  console.log("🔍 Profile scraper v2 running on:", window.location.href);

  // Wait for page to load
  setTimeout(() => {

    // ===== WEBSITE EXTRACTION =====
    let website = null;

    // Strategy 1: Look for the authority data-item-id (most reliable for this page)
    const websiteButton = document.querySelector('[data-item-id="authority"]');
    if (websiteButton) {
      // It might be a link or contain a link
      if (websiteButton.tagName === 'A') {
        website = websiteButton.href;
      } else {
        const link = websiteButton.querySelector('a');
        if (link) website = link.href;
      }
      if (website) {
        console.log("✅ Website found via data-item-id='authority':", website);
      }
    }

    // Strategy 2: Look for class CsEnBe with authority
    if (!website) {
      const csEnBeLinks = document.querySelectorAll('a.CsEnBe[data-item-id="authority"]');
      if (csEnBeLinks.length > 0) {
        website = csEnBeLinks[0].href;
        console.log("✅ Website found via a.CsEnBe[data-item-id='authority']:", website);
      }
    }

    // Strategy 3: Fallback - find any external link that's not Google
    if (!website) {
      const allLinks = Array.from(document.querySelectorAll('a'));
      const externalLink = allLinks.find(a => {
        const href = a.href || '';
        const text = (a.innerText || '').toLowerCase();
        return href.startsWith('http') &&
               !href.includes('google.com') &&
               !href.includes('gstatic.com') &&
               !href.includes('maps') &&
               (text.includes('website') || text === 'website');
      });

      if (externalLink) {
        website = externalLink.href;
        console.log("✅ Website found via fallback:", website);
      }
    }

    // ===== PHONE NUMBER EXTRACTION =====
    let phone = null;

    // Strategy 1: Look for phone:tel: data-item-id (most reliable)
    const phoneButton = document.querySelector('[data-item-id^="phone:tel:"]');
    if (phoneButton) {
      const dataItemId = phoneButton.getAttribute('data-item-id');
      console.log("  Found phone button with data-item-id:", dataItemId);

      // Extract from data-item-id
      if (dataItemId && dataItemId.includes('tel:')) {
        const telMatch = dataItemId.match(/tel:([+\d]+)/);
        if (telMatch && telMatch[1]) {
          phone = telMatch[1];
          console.log("✅ Phone found via data-item-id:", phone);
        }
      }

      // Also try to get from the button's text content if data extraction failed
      if (!phone) {
        const phoneText = phoneButton.innerText || phoneButton.textContent;
        const phoneMatch = phoneText.match(/\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
        if (phoneMatch) {
          phone = phoneMatch[0];
          console.log("✅ Phone found via button text:", phone);
        }
      }
    }

    // Strategy 2: Look for class CsEnBe with phone data-item-id
    if (!phone) {
      const csEnBePhone = document.querySelector('button.CsEnBe[data-item-id^="phone"]');
      if (csEnBePhone) {
        const dataItemId = csEnBePhone.getAttribute('data-item-id');
        if (dataItemId && dataItemId.includes('tel:')) {
          const telMatch = dataItemId.match(/tel:([+\d]+)/);
          if (telMatch && telMatch[1]) {
            phone = telMatch[1];
            console.log("✅ Phone found via button.CsEnBe:", phone);
          }
        }
      }
    }

    // Strategy 3: Search for buttons with phone-related aria-labels
    if (!phone) {
      const buttons = document.querySelectorAll('button');
      for (const button of buttons) {
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes('phone')) {
          const phoneMatch = ariaLabel.match(/\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
          if (phoneMatch) {
            phone = phoneMatch[0];
            console.log("✅ Phone found via aria-label:", phone);
            break;
          }
        }
      }
    }

    // Strategy 4: Last resort - text search
    if (!phone) {
      const textElements = document.querySelectorAll('.Io6YTe, .fontBodyMedium');
      for (const el of textElements) {
        const text = el.textContent || '';
        const phoneMatch = text.match(/\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
        if (phoneMatch) {
          // Verify it looks like a real phone number (not a date or other number)
          const cleaned = phoneMatch[0].replace(/\D/g, '');
          if (cleaned.length === 10) {
            phone = phoneMatch[0];
            console.log("✅ Phone found via text search:", phone);
            break;
          }
        }
      }
    }

    // Format phone number
    if (phone) {
      // If it doesn't have a country code and it's 10 digits, add +1
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length === 10 && !phone.startsWith('+')) {
        phone = `+1${cleaned}`;
      } else if (cleaned.length > 10) {
        phone = `+${cleaned}`;
      }
      console.log("📱 Final formatted phone:", phone);
    }

    // ===== SEND RESULTS =====
    console.log("📤 Sending:", { website, phone });

    chrome.runtime.sendMessage({
      action: "profileDataExtracted",
      data: {
        website: website,
        phone: phone,
        url: window.location.href
      }
    });

  }, 2500); // Wait 2.5 seconds for page to fully load

})();
