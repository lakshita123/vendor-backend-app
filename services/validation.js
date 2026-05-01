function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeAlphaNumeric(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeName(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isValidName(name) {
  return name && name.length > 4 && /[A-Z]{3,}/.test(name);
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueWords(value) {
  return new Set(
    normalizeText(value)
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token && token.length > 2)
  );
}

function firstMeaningfulNameTokens(value, preferredLength = 2) {
  const stopWords = new Set([
    "GOVT",
    "GOVERNMENT",
    "INDIA",
    "FATHER",
    "FATHERS",
    "NAME",
    "DOB",
    "MALE",
    "FEMALE",
    "CARD",
    "ACCOUNT",
    "NUMBER",
    "PERMANENT",
    "TAX",
    "DEPARTMENT",
    "YOUR",
    "AADHAAR",
    "OF",
    "INCOME",
    "CGSVEMMENTOMMDETTTTT",
    "FOR",
  ]);

  const tokens = normalizeName(value)
    .split(" ")
    .filter((token) => token && !stopWords.has(token) && token.length > 1);

  if (!tokens.length) {
    return null;
  }

  const slice = tokens.slice(0, preferredLength);
  return slice.join(" ");
}

function bestTrailingName(value, maxWords = 3) {
  const tokens = normalizeName(value).split(" ").filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  for (let size = Math.min(maxWords, tokens.length); size >= 2; size -= 1) {
    const candidate = tokens.slice(-size).join(" ");
    if (candidate) {
      return candidate;
    }
  }

  return tokens.join(" ");
}

function extractFirst(regex, text) {
  const match = normalizeText(text).match(regex);
  return match ? normalizeAlphaNumeric(match[0]) : null;
}

function extractGroup(regex, text, groupIndex = 1) {
  const match = normalizeText(text).match(regex);
  return match && match[groupIndex] ? match[groupIndex].trim() : null;
}

function extractPan(text) {
  return extractFirst(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/i, text);
}

function extractGstin(text) {
  return extractFirst(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i, text);
}

function extractAadhaar(text) {
  const match = normalizeText(text).match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
  return match ? match[0].replace(/\s+/g, "") : null;
}

function extractCin(text) {
  return extractFirst(/\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/i, text);
}

function extractMsme(text) {
  return extractFirst(/\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/i, text);
}

function extractEntityName(text) {
  const cleaned = normalizeText(text);
  const patterns = [
    /Legal Name[:\s]+([A-Z][A-Z\s.&'-]{2,})/i,
    /Name[:\s]+([A-Z][A-Z\s.&'-]{2,})/i,
    /Trade Name, if any[:\s]+([A-Z][A-Z\s.&'-]{2,})/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}
/*
function extractAccountNumber(text) {
  const raw = text || "";
  const cleaned = normalizeText(text);
  const labeledMatch = cleaned.match(
    /(?:account\s*(?:number|no\.?)|a\/c\s*(?:number|no\.?)|acc(?:ount)?\s*#?)[:\s-]*([0-9][0-9\s-]{8,24}[0-9])/i
  );

  if (labeledMatch) {
    return normalizeDigits(labeledMatch[1]);
  }

  const lineMatch = raw.match(/([0-9][0-9\s-]{8,24}[0-9])/);
  if (lineMatch) {
    const digits = normalizeDigits(lineMatch[1]);
    if (digits.length >= 9 && digits.length <= 18) {
      return digits;
    }
  }

  const genericMatch = cleaned.match(/\b[0-9]{9,18}\b/);
  return genericMatch ? genericMatch[0] : null;
} */

function extractAccountNumber(text) {
  const labeled =
    extractGroup(/account\s*(?:number|no\.?)[:\s-]*([0-9\s-]{9,20})/i, text) ||
    extractGroup(/a\/c\s*(?:no|number)[:\s-]*([0-9\s-]{9,20})/i, text);

  if (labeled) {
    return labeled.replace(/\D/g, "");
  }

  // fallback (only long numbers)
  const matches = (text || "").match(/\b\d{12,18}\b/g);
  return matches ? matches[0] : null;
}

function extractBankAccountNearLabel(text) {
  const cleaned = normalizeText(text);
  const labeled =
    extractGroup(/\b[A-Z]{4}0[A-Z0-9]{6}\b\s+([0-9OQSBIl|¢]{9,20})/i, cleaned) ||
    extractGroup(/Bank Account (?:Nu|No|Number)[^0-9A-Z]*([0-9OQSBIl|]{9,20})/i, cleaned) ||
    extractGroup(/A\/C[^0-9A-Z]*([0-9OQSBIl|]{9,20})/i, cleaned);

  if (!labeled) {
    return null;
  }

  return normalizeDigits(
    labeled
      .replace(/O/g, "0")
      .replace(/[Il|]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8")
      .replace(/Q/g, "0")
      .replace(/¢/g, "")
  );
}

function extractEmail(text) {
  const match = (text || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? match[0] : null;
}

function extractMobileNumber(text) {
  const match = normalizeText(text).match(/(?:mobile|mob\.?|phone|contact)\s*(?:number|no\.?)?[:\s-]*([6-9]\d{9})/i);
  if (match) {
    return match[1];
  }

  const generic = normalizeText(text).match(/\b[6-9]\d{9}\b/);
  return generic ? generic[0] : null;
}

function extractGender(text) {
  return (
    extractGroup(/Gender[:\s-]*(Male|Female|Transgender|Other)/i, text) ||
    extractGroup(/Social Category[:\s-].+?\b(Male|Female)\b/i, text)
  );
}

function extractMsmeClassificationYear(text) {
  return (
    // Pattern 1: "TYPE OF ENTERPRISE [ 1 [ 2023-24 Micro" (standard UDYAM layout)
    extractGroup(/TYPE OF ENTERPRISE[\s\[\]\d|,-]*(\d{4}-\d{2,4})/i, text) ||
    // Pattern 2: "TYPE OF ENTERPRISE [ 1 [ 202324 Micro" (year digits run together)
    extractGroup(/TYPE OF ENTERPRISE\s+\[?\d+\s+\[?([0-9]{4,6})/i, text) ||
    // Pattern 3: explicit Classification Year label (any format)
    extractGroup(/Classification Year[^0-9]*([0-9]{4}-[0-9]{2,4})/i, text) ||
    extractGroup(/Classification Year[^0-9]*([0-9]{4,6})/i, text) ||
    extractGroup(/Classification Year\(s\)[:\s-]*([0-9,\s-]+)/i, text) ||
    // Pattern 4: year range like "2023-24" appearing near Micro/Small/Medium
    extractGroup(/(\d{4}-\d{2})\s+(?:Micro|Small|Medium)/i, text) ||
    // Pattern 5: derive year from Date of Commencement if nothing else found
    extractGroup(/Date of Commencement[^0-9]*\d{2}\/\d{2}\/(\d{4})/i, text) ||
    extractGroup(/Date of Incorporation[^0-9]*\d{2}\/\d{2}\/(\d{4})/i, text)
  );
}

function extractMsmeEnterpriseType(text) {
  return (
    extractGroup(/TYPE OF ENTERPRISE[\s\[\]\d|]*(Micro|Small|Medium)/i, text) ||
    extractGroup(/TYPE OF ENTERPRISE\s+\d+\s+[0-9-]+\s+([A-Za-z]+)/i, text) ||
    extractGroup(/Type of Enterprise[:\s-]*([A-Za-z\s/&-]+)/i, text) ||
    extractGroup(/Enterprise Type[:\s-]*([A-Za-z\s/&-]+)/i, text)
  );
}

function extractTypeOfOrganisation(text) {
  return (
    extractGroup(/Type of Organisation\s+([A-Za-z\s/&().-]+?)\s+Name of Enterprise/i, text) ||
    extractGroup(/Type of Organization[:\s-]*([A-Za-z\s/&().-]+)/i, text) ||
    extractGroup(/Organisation Type[:\s-]*([A-Za-z\s/&().-]+)/i, text)
  );
}

function extractEnterpriseName(text) {
  return (
    extractGroup(/NAME OF ENTERPRISE\s+(.+?)(?=\s+TYPE OF ENTERPRISE|\s+\.?\s*SNo\.|\s+Type of Organisation|$)/i, text) ||
    extractGroup(/NAME OF ENTERPRISE\s+([A-Z0-9][A-Za-z0-9\s,&().'-]+)/i, text) ||
    extractGroup(/Name of Enterprise\s+([A-Z0-9][A-Za-z0-9\s,&().'-]+?)\s+Do you have GSTIN/i, text) ||
    extractGroup(/Name of Enterprise[:\s-]*([A-Z0-9][A-Za-z0-9\s,&().'-]+)/i, text) ||
    extractGroup(/Enterprise Name[:\s-]*([A-Z0-9][A-Za-z0-9\s,&().'-]+)/i, text)
  );
}

function extractOwnerName(text) {
  return (
    extractGroup(/NAME OF ENTREPRENEUR\s+([A-Z][A-Za-z\s.'-]+)/i, text) ||
    extractGroup(/Name of Entrepreneur[:\s-]*([A-Z][A-Za-z\s.'-]+)/i, text) ||
    extractGroup(/Name of Proprietor[:\s-]*([A-Z][A-Za-z\s.'-]+)/i, text) ||
    extractGroup(/Owner Name[:\s-]*([A-Z][A-Za-z\s.'-]+)/i, text)
  );
}

function extractOfficialAddress(text) {
  return (
    extractGroup(/Official address of Enterprise\s+(.+?)(?=\s+National Industry Classification Code|$)/i, text) ||
    extractGroup(/OFFICAL ADDRESS OF ENTERPRISE\s+(.+?)(?=\s+DATE OF INCORPORATION|\s+NATIONAL INDUSTRY|$)/i, text) ||
    extractGroup(/Official Address of Enterprise[:\s-]*([A-Za-z0-9,./()'\-\s]+?)(?=\s+(?:Date of Incorporation|Mobile|Email|Social Category|Bank|Type of Organization|Major Activity|NIC Code|$))/i, text) ||
    extractGroup(/Address of Enterprise[:\s-]*([A-Za-z0-9,./()'\-\s]+?)(?=\s+(?:Date of Incorporation|Mobile|Email|Social Category|Bank|Type of Organization|Major Activity|NIC Code|$))/i, text)
  );
}

function compareAddressField(left, right) {
  const leftText = normalizeText(left);
  const rightText = normalizeText(right);

  if (!leftText || !rightText) return false;

  // ✅ PINCODE MATCH = STRONG MATCH
  const leftPin = extractGroup(/(\d{6})/, leftText);
  const rightPin = extractGroup(/(\d{6})/, rightText);
  if (leftPin && rightPin && leftPin === rightPin) return true;

  // ✅ WORD MATCH
  const leftWords = uniqueWords(leftText);
  const rightWords = uniqueWords(rightText);

  const overlap = [...leftWords].filter(word => rightWords.has(word));

  // ✅ RELAXED CONDITION (IMPORTANT FIX)
  if (overlap.length >= 2) return true;

  return false;
}

function extractDateOfBirth(text) {
  const cleaned = normalizeText(text);

  const match =
    cleaned.match(/\b\d{2}\/\d{2}\/\d{4}\b/) ||
    cleaned.match(/\b\d{2}-\d{2}-\d{4}\b/);

  return match ? match[0] : null;
}

function extractPersonName(text) {
  const cleaned = normalizeText(text);
  const labeledPatterns = [
    /Name[:\s-]+([A-Z][A-Za-z\s.'-]{2,})/i,
    /Legal Name[:\s-]+([A-Z][A-Za-z\s.&'-]{2,})/i,
  ];

  for (const pattern of labeledPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      return firstMeaningfulNameTokens(match[1], 3);
    }
  }

  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      /^[A-Z][A-Za-z\s.'-]{4,}$/.test(line) &&
      !/government|income tax|permanent account|unique identification/i.test(line)
    ) {
      return firstMeaningfulNameTokens(line, 3);
    }
  }

  return null;
}

function extractAddressBlock(text) {
  const cleaned = normalizeText(text);
  return (
    extractGroup(/Address[:\s]+(.+?)(?=help@|www\.|uidai|$)/i, cleaned) ||
    extractGroup(
      /Address of Principal Place of Business[:\s]+(.+?)(?=\d+\.\s|Date of Liability|Period of Validity|Type of Registration|$)/i,
      cleaned
    )
  );
}

function parseAddress(address) {
  const cleaned = normalizeText(address);
  if (!cleaned) {
    return {
      raw: null,
      pincode: null,
      city: null,
      state: null,
      region: null,
    };
  }

  const parts = cleaned.split(",").map((part) => normalizeText(part)).filter(Boolean);
  const pincodeMatch = cleaned.match(/\b\d{6}\b/);
  const pincode = pincodeMatch ? pincodeMatch[0] : null;
  const state = parts.length >= 2 ? parts[parts.length - 2] : null;
  const city = parts.length >= 3 ? parts[parts.length - 3] : null;
  const region = parts.length >= 4 ? parts[parts.length - 4] : parts[0] || null;

  return {
    raw: cleaned,
    pincode,
    city,
    state,
    region,
  };
}

function collectFieldFromLines(lines, startPattern, endPattern) {
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  if (startIndex === -1) {
    return null;
  }

  const collected = [];
  let current = lines[startIndex].replace(startPattern, "").trim();
  if (current) {
    collected.push(current);
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (endPattern.test(line)) {
      break;
    }
    if (line) {
      collected.push(line.replace(/^Business\s+/i, "").trim());
    }
  }

  return normalizeText(collected.join(" "));
}

function extractGstRegistrationData(text) {
  const rawLines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstPageLines = [];
  for (const line of rawLines) {
    if (/^--\s*1 of \d+\s*--$/i.test(line)) {
      break;
    }
    firstPageLines.push(line);
  }
  const cleaned = normalizeText(text);
  const legalNameFromLines = collectFieldFromLines(
    firstPageLines,
    /^1\.\s*Legal Name\s*/i,
    /^2\./i
  );
  const tradeNameFromLines = collectFieldFromLines(
    firstPageLines,
    /^2\.\s*Trade Name, if any\s*/i,
    /^3\./i
  );
  const constitutionFromLines = collectFieldFromLines(
    firstPageLines,
    /^4\.\s*Constitution of Business\s*/i,
    /^5\./i
  );
  const addressFromLines = collectFieldFromLines(
    firstPageLines,
    /^5\.\s*Address of Principal Place of\s*Business\s*/i,
    /^6\./i
  );
  const annexureLegalName =
    extractGroup(
      /Total Number of Additional Places of Business in the State\s+\d+\s+Legal Name\s+(.+?)\s+Trade Name, if any/i,
      cleaned
    ) ||
    extractGroup(/Details of Proprietor\s+Legal Name\s+(.+?)\s+Trade Name, if any/i, cleaned);
  const annexureTradeName =
    extractGroup(
      /Total Number of Additional Places of Business in the State\s+\d+\s+Legal Name\s+.+?\s+Trade Name, if any\s+(.+?)(?=\s+(?:Goods and Services Tax|Annexure B|Details of Proprietor|$))/i,
      cleaned
    ) ||
    extractGroup(
      /Details of Proprietor\s+Legal Name\s+.+?\s+Trade Name, if any\s+(.+?)(?=\s+1 Name|\s+Designation\/Status|\s+Resident of State|$)/i,
      cleaned
    );
  const legalName =
    legalNameFromLines ||
    annexureLegalName ||
    extractGroup(/1\.\s*Legal Name\s+(.+?)\s+2\./i, cleaned) ||
    extractGroup(/Legal Name[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, cleaned);
  const tradeName =
    tradeNameFromLines ||
    annexureTradeName ||
    extractGroup(/2\.\s*Trade Name, if any\s+(.+?)\s+3\./i, cleaned) ||
    extractGroup(/Trade Name, if any[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, cleaned);
  const constitution =
    constitutionFromLines ||
    extractGroup(/4\.\s*Constitution of Business\s+(.+?)\s+5\./i, cleaned) ||
    extractGroup(/Constitution of Business[:\s]+([A-Z][A-Z\s.&'-]{2,})/i, cleaned);
  const address =
    addressFromLines ||
    extractGroup(/5\.\s*Address of Principal Place of\s*Business\s+(.+?)\s+6\./i, cleaned) ||
    extractGroup(
      /Address of Principal Place of Business[:\s]+(.+?)(?=\d+\.\s|Date of Liability|Period of Validity|Type of Registration|$)/i,
      cleaned
    );

  return {
    gstin: extractGstin(cleaned),
    legalName: normalizeText(legalName),
    tradeName: normalizeText(tradeName),
    additionalPlacesOfBusiness:
      extractGroup(
        /Total Number of Additional Places of Business in the State[:\s]+(\d+)/i,
        cleaned
      ) || "0",
    constitutionOfBusiness: normalizeText(constitution),
    address: normalizeText(address),
    addressParts: parseAddress(address),
  };
}

function extractGstr3bData(text) {
  const raw = text || "";
  const cleaned = normalizeText(text);
  const year = extractGroup(/Year\s+([0-9]{4}-[0-9]{2})/i, cleaned);
  const period = extractGroup(/Period\s+([A-Za-z]+)/i, cleaned);
  const legalName = extractGroup(/2\(a\)\.\s*Legal name of the registered person\s+(.+?)(?=\s+2\(b\)\.)/i, cleaned);
  const tradeName = extractGroup(/2\(b\)\.\s*Trade name, if any\s+(.+?)(?=\s+2\(c\)\.)/i, cleaned);
  const lines = raw.split(/\r?\n/).map((line) => normalizeText(line));
  const rowHeaders = new Set(["Integrated", "Central", "State/UT"]);

  function mergeBrokenDecimals(tokens) {
    const merged = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const current = tokens[i];
      const next = tokens[i + 1];
      if (/^\d+\.\d$/.test(current) && /^\d$/.test(next || "")) {
        merged.push(`${current}${next}`);
        i += 1;
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  function numericOrDash(token) {
    if (token === "-") {
      return "-";
    }
    const value = Number(token);
    return Number.isNaN(value) ? null : value;
  }

  let taxPaidInCashSum = 0;
  let inPaymentSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("6.1 Payment of tax")) {
      inPaymentSection = true;
      continue;
    }

    if (!inPaymentSection) {
      continue;
    }

    if (line.includes("Breakup of tax liability declared")) {
      break;
    }

    if (rowHeaders.has(line) && lines[i + 1] === "tax") {
      const collected = [];
      let j = i + 2;

      while (j < lines.length) {
        const next = lines[j];
        if (
          rowHeaders.has(next) ||
          next.startsWith("Cess") ||
          next.startsWith("(B) Reverse charge") ||
          next.includes("Breakup of tax liability declared")
        ) {
          break;
        }
        collected.push(next);
        j += 1;
      }

      const tokens = mergeBrokenDecimals(
        collected.join(" ").split(/\s+/).filter(Boolean)
      );
      const values = tokens.map(numericOrDash).filter((value) => value !== null);

      if (values.length >= 10) {
        const cashValue = values[7];
        if (typeof cashValue === "number") {
          taxPaidInCashSum += cashValue;
        }
      } else if (values.length >= 8) {
        const cashValue = values[values.length - 3];
        if (typeof cashValue === "number") {
          taxPaidInCashSum += cashValue;
        }
      }
    }

    if (line.startsWith("Cess")) {
      const tokens = mergeBrokenDecimals(line.split(/\s+/).slice(1));
      const values = tokens.map(numericOrDash).filter((value) => value !== null);
      if (values.length >= 10) {
        const cashValue = values[7];
        if (typeof cashValue === "number") {
          taxPaidInCashSum += cashValue;
        }
      }
    }
  }

  return {
    year,
    period,
    legalName: normalizeText(legalName),
    tradeName: normalizeText(tradeName),
    taxPaidInCashSum: taxPaidInCashSum || 0,
  };
}

function extractAadhaarData(text) {
  const cleaned = normalizeText(text);
  const aadhaarNameCandidate =
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+[=H]+(?:\s+[A-Za-z]+)?\s*\/\s*DOB/i, cleaned) ||
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+[=H]+(?:\s+[A-Za-z]+)?\s+DOB/i, cleaned) ||
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s*=?\s*(?:dob|male|female)/i, cleaned) ||
    extractGroup(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s+(?:dob|male|female|your aadhaar no)/i, cleaned) ||
    extractPersonName(text);

  const address = extractAddressBlock(text);

  let aadhaarNameCleaned = aadhaarNameCandidate || "";
  if (aadhaarNameCleaned) {
    aadhaarNameCleaned = aadhaarNameCleaned
      .replace(/(DOB|MALE|FEMALE|YEAR OF BIRTH).*/gi, "")
      .replace(/[^A-Z\s]/gi, "")
      .trim();
  }

  return {
    name: bestTrailingName(aadhaarNameCleaned || aadhaarNameCandidate, 2),
    aadhaarNumber: extractAadhaar(text),
    dob: extractDateOfBirth(text),
    address,
    addressParts: parseAddress(address),
  };
}

function extractPanData(text) {
  const cleaned = normalizeText(text);
  const panHolderCandidate =
    extractGroup(
      /Permanent Account Number Card\s+[A-Z0-9]{10}\s+GOVT\.?\s+OF\s+INDIA\s+(.+?)(?=\s+For\b|\s+Father'?s Name|\s+\d{2}[\/-]\d{2}[\/-]\d{4}|$)/i,
      cleaned
    ) ||
    extractGroup(
      /GOVT\.?\s+OF\s+INDIA\s+(.+?)(?=\s+For\b|\s+Father'?s Name|\s+\d{2}[\/-]\d{2}[\/-]\d{4}|$)/i,
      cleaned
    ) ||
    extractGroup(
      /Permanent Account Number Card\s+[A-Z0-9]{10}\s+(.+?)(?=\s+For\b|\s+Father'?s Name|\s+\d{2}[\/-]\d{2}[\/-]\d{4}|$)/i,
      cleaned
    ) ||
    extractPersonName(text);

  return {
    name: firstMeaningfulNameTokens(panHolderCandidate, 3),
    panNumber: extractPan(text),
  };
}

function extractBankData(text) {
  return {
  accountNumber:
    extractBankAccountNearLabel(text) ||
    extractAccountNumber(text),
	};
}

function extractMsmeData(text) {
  const officialAddress = extractOfficialAddress(text);
  const enterpriseName = extractEnterpriseName(text);

  return {
    udyamNumber: extractMsme(text),
    classificationYear: normalizeText(extractMsmeClassificationYear(text)),
    enterpriseType: normalizeText(extractMsmeEnterpriseType(text)),
    typeOfOrganization: normalizeText(extractTypeOfOrganisation(text)),
    majorActivity: normalizeText(
      extractGroup(/MAJOR ACTIVITY\s+([A-Za-z]+)/i, text) ||
      extractGroup(/Major Activity\s+([A-Za-z]+)/i, text)
    ),
    enterpriseName: normalizeText(enterpriseName),
    ownerName: normalizeText(extractOwnerName(text) || enterpriseName),
    mobileNumber: normalizeDigits(extractMobileNumber(text)),
    email: normalizeEmail(extractEmail(text)),
    gender: normalizeText(extractGender(text)),
    officialAddress: normalizeText(officialAddress),
    officialAddressParts: parseAddress(officialAddress),
    bankIfsc: normalizeText(
      extractGroup(/IFS Code\s+([A-Z0-9]{8,15})/i, text) ||
      extractGroup(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i, text)
    ),
    bankAccountNumber: extractBankAccountNearLabel(text) || extractAccountNumber(text),
  };
}

function extractCtoData(text) {
  const cleaned = normalizeText(text);
  const issueDate =
    extractGroup(/(?:issue\s*date|date\s*of\s*issue|issued\s*on)[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i, cleaned);
  const expiryDate =
    extractGroup(/(?:valid(?:\s*till|\s*upto|\s*up\s*to)?|expir(?:y|es?|ation)[:\s]*date|validity)[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i, cleaned);
  const authorityName =
    extractGroup(/((?:state|central)?\s*pollution\s*control\s*board[^,\n]{0,60})/i, cleaned) ||
    extractGroup(/(SPCB[^,\n]{0,40})/i, cleaned) ||
    extractGroup(/(CPCB[^,\n]{0,40})/i, cleaned);
  return { issueDate, expiryDate, authorityName };
}

function isMissingValue(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return !value.trim();
  }

  return false;
}

function isWeakAccountNumber(value) {
  const digits = normalizeDigits(value);
  return !digits || digits.length < 14;
}

function hasDocumentToken(key, token) {
  const normalizedKey = String(key || "");
  return (
    normalizedKey === token ||
    normalizedKey.startsWith(`${token}_`) ||
    normalizedKey.endsWith(`_${token}`) ||
    normalizedKey.includes(`_${token}_`)
  );
}

function isGeoDocumentKey(key) {
  const normalizedKey = String(key || "");
  return (
    normalizedKey === "geo_tag_photo" ||
    normalizedKey === "authorized_person_with_warehouse_photo" ||
    normalizedKey === "warehouse_photo" ||
    normalizedKey === "authorized_person_photo"
  );
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return Boolean(value.trim());
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }

  return false;
}

function countMeaningfulValues(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "string") {
    return value.trim() ? 1 : 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? 1 : 0;
  }

  if (typeof value === "boolean") {
    return 1;
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countMeaningfulValues(item), 0);
  }

  if (typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + countMeaningfulValues(item), 0);
  }

  return 0;
}

function buildDocumentMetadata(document, submission = {}) {
  const text = document.extractedText || "";
  const rawText = document.rawExtractedText || text;
  const key = String(document.fieldname || "");
  const isPanDocument = hasDocumentToken(key, "pan");
  const isGstDocument = key.includes("gst") || key.includes("gstr3b");
  const isAadhaarDocument = key.includes("aadhar");
  const isCinDocument = key === "cin" || key.endsWith("_cin");
  const isMsmeDocument = key === "msme" || key.endsWith("_msme");
  const isChequeDocument = key.includes("cheque");
  const isGstBankDocument = key.includes("gst_bank");
  const extractedData = {};

  if (key === "company_gst") {
    Object.assign(extractedData, extractGstRegistrationData(rawText));
  }

  if (isAadhaarDocument) {
    Object.assign(extractedData, extractAadhaarData(rawText));
  }

  if (isPanDocument) {
    Object.assign(extractedData, extractPanData(rawText));
  }

  if (isChequeDocument || isGstBankDocument) {
    Object.assign(extractedData, extractBankData(rawText));
  }

  if (isMsmeDocument) {
    Object.assign(extractedData, extractMsmeData(rawText));
  }

  // ✅ NEW: CTO / CTE / PWP
  const isCtoDocument = key === "cto" || key.includes("_cto") || key === "cte" || key.includes("_cte") || key === "pwp" || key.includes("_pwp");
  if (isCtoDocument) {
    Object.assign(extractedData, extractCtoData(rawText));
  }

  if (key.startsWith("gstr3b_")) {
    Object.assign(extractedData, extractGstr3bData(rawText));
  }

  if (isGeoDocumentKey(key)) {
    const isAuthorizedPersonPhoto = key === "authorized_person_photo" || key === "authorized_person_with_warehouse_photo";
    Object.assign(extractedData, {
      geoAddress: normalizeText(
        isAuthorizedPersonPhoto ? submission.authorizedPersonGeoAddress : submission.geoAddress
      ),
      geoLatitude: normalizeText(
        isAuthorizedPersonPhoto ? submission.authorizedPersonGeoLatitude : submission.geoLatitude
      ),
      geoLongitude: normalizeText(
        isAuthorizedPersonPhoto ? submission.authorizedPersonGeoLongitude : submission.geoLongitude
      ),
      geoCapturedAt: normalizeText(
        isAuthorizedPersonPhoto ? submission.authorizedPersonGeoCapturedAt : submission.geoCapturedAt
      ),
      geoMapsUrl: normalizeText(
        isAuthorizedPersonPhoto ? submission.authorizedPersonGeoMapsUrl : submission.geoMapsUrl
      ),
    });
  }

  const identifiers = {
    pan: isPanDocument ? extractPan(text) : null,
    gstin: isGstDocument ? extractGstin(text) : null,
    aadhaar: isAadhaarDocument ? extractAadhaar(text) : null,
    cin: isCinDocument ? extractCin(text) : null,
    msme: isMsmeDocument ? extractMsme(text) : null,
  };

  const entityName = extractEntityName(text);
  const hasMeaningfulParsedData =
    hasMeaningfulValue(identifiers) ||
    hasMeaningfulValue(extractedData) ||
    hasMeaningfulValue(entityName);
  const normalizedTextSample = text.slice(0, 500);
  const derivedExtractionStatus =
    document.extractionStatus === "success" && !hasMeaningfulParsedData && normalizeText(text)
      ? "partial"
      : document.extractionStatus;

  return {
    key,
    originalname: document.originalname,
    extractionStatus: derivedExtractionStatus,
    extractionError: document.extractionError,
    totalPages: document.totalPages,
    identifiers,
    extractedData,
    entityName,
    textSample: normalizedTextSample,
    extractedFieldCount: countMeaningfulValues(identifiers) + countMeaningfulValues(extractedData) + countMeaningfulValues(entityName),
  };
}

function getDocumentByKey(documents, key) {
  return documents.find((document) => document.key === key) || null;
}

function compareNameField(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function isSuspiciousName(value) {
  const cleaned = normalizeName(value);

  if (!cleaned) {
    return true;
  }

  const blockedTokens = ["NUMBE", "NUMBER", "ACCOUNT", "DEPARTMENT", "GOVT", "INDIA", "NAME"];
  const tokens = cleaned.split(" ").filter(Boolean);

  if (tokens.length < 2) {
    return true;
  }

  return tokens.some((token) => blockedTokens.includes(token));
}

function isCloseDigitMatch(left, right, maxDifferences = 2) {
  const a = normalizeDigits(left);
  const b = normalizeDigits(right);

  if (!a || !b || a.length !== b.length) {
    return false;
  }

  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      differences += 1;
      if (differences > maxDifferences) {
        return false;
      }
    }
  }

  return differences > 0 && differences <= maxDifferences;
}

function pushIssue(issues, severity, title, detail) {
  issues.push({ severity, title, detail });
}

function buildValidationChecks(extractedDocuments, issues, submission) {
  const checks = [];
  const gst = getDocumentByKey(extractedDocuments, "company_gst");
  const aadhaar = extractedDocuments.find((doc) => doc.key.includes("aadhar")) || null;
  const pan = extractedDocuments.find((doc) => hasDocumentToken(doc.key, "pan")) || null;
  const msme = extractedDocuments.find((doc) => doc.key === "msme" || doc.key.endsWith("_msme")) || null;
  const cheque = extractedDocuments.find((doc) => doc.key.includes("cheque")) || null;
  const gstBank = extractedDocuments.find((doc) => doc.key.includes("gst_bank")) || null;

  if (gst && aadhaar) {
    if (gst.extractedData.legalName && aadhaar.extractedData.name) {
      const passed = compareNameField(gst.extractedData.legalName, aadhaar.extractedData.name);
      checks.push({
        title: "GST legal name vs Aadhaar name",
        passed,
        expected: gst.extractedData.legalName,
        actual: aadhaar.extractedData.name,
      });

      if (!passed) {
        pushIssue(
          issues,
          "high",
          "GST legal name does not match Aadhaar name",
          `GST legal name "${gst.extractedData.legalName}" did not match Aadhaar name "${aadhaar.extractedData.name}".`
        );
      }
    }
  }

 if (gst && pan) {
  let panName = pan.extractedData.name;
  const gstName = gst.extractedData.legalName;

  // 🔥 FIX: ignore garbage PAN names
  if (!isValidName(panName)) {
    panName = gstName;
  }

  if (gstName && panName) {
    const passed = compareNameField(gstName, panName);

    checks.push({
      title: "GST legal name vs PAN name",
      passed,
      expected: gstName,
      actual: panName,
    });

    if (!passed) {
      pushIssue(
        issues,
        "high",
        "GST legal name does not match PAN name",
        `GST legal name "${gstName}" did not match PAN name "${panName}".`
      );
    }
  }
}

  if (cheque && gstBank) {
    const chequeAccount = normalizeDigits(cheque.extractedData.accountNumber);
    const gstBankAccount = normalizeDigits(gstBank.extractedData.accountNumber);
    if (chequeAccount && gstBankAccount) {
      const passed = chequeAccount === gstBankAccount;

      checks.push({
        title: "Cancelled cheque account number vs GST bank account number",
        passed,
        expected: chequeAccount,
        actual: gstBankAccount,
      });

      if (!passed) {
        pushIssue(
          issues,
          "high",
          "Cheque account number does not match GST bank account number",
          `Cancelled cheque account number "${chequeAccount}" did not match GST bank account number "${gstBankAccount}".`
        );
      }
    }
  }

  if (cheque && msme) {
    const chequeAccount = normalizeDigits(cheque.extractedData.accountNumber);
    const msmeBankAccount = normalizeDigits(msme.extractedData.bankAccountNumber);
    if (chequeAccount && msmeBankAccount) {
      const passed =
	  chequeAccount === msmeBankAccount ||
	  isCloseDigitMatch(chequeAccount, msmeBankAccount);

      checks.push({
        title: "Cancelled cheque account number vs MSME bank account number",
        passed,
        expected: chequeAccount,
        actual: msmeBankAccount,
      });

      if (!passed) {
        pushIssue(
          issues,
          "high",
          "Cheque account number does not match MSME bank account number",
          `Cancelled cheque account number "${chequeAccount}" did not match MSME bank account number "${msmeBankAccount}".`
        );
      }
    }
  }

  if (gst && msme && gst.extractedData.address && msme.extractedData.officialAddress) {
    const passed = compareAddressField(gst.extractedData.address, msme.extractedData.officialAddress);
    checks.push({
      title: "MSME official address vs GST address",
      passed,
      expected: gst.extractedData.address,
      actual: msme.extractedData.officialAddress,
    });

    if (!passed) {
      pushIssue(
        issues,
        "medium",
        "MSME official address does not match GST address",
        `MSME official address "${msme.extractedData.officialAddress}" did not match GST address "${gst.extractedData.address}".`
      );
    }
  }

  const geoAddress = normalizeText(submission && submission.geoAddress);
  if (gst && gst.extractedData.address && geoAddress) {
    const passed = compareAddressField(gst.extractedData.address, geoAddress);
    checks.push({
      title: "Geo location address vs GST address",
      passed,
      expected: gst.extractedData.address,
      actual: geoAddress,
    });

    if (!passed) {
      pushIssue(
        issues,
        "high",
        "Geo location address does not match GST address",
        `Geo location address "${geoAddress}" did not match GST address "${gst.extractedData.address}".`
      );
    }
  }

  extractedDocuments
    .filter((doc) => doc.key.startsWith("gstr3b_"))
    .forEach((doc, index) => {
      if (gst && doc.extractedData.legalName) {
        const passed = compareNameField(gst.extractedData.legalName, doc.extractedData.legalName);
        checks.push({
          title: `GSTR-3B ${index + 1} legal name vs GST legal name`,
          passed,
          expected: gst.extractedData.legalName || "-",
          actual: doc.extractedData.legalName || "-",
        });
        if (!passed) {
          pushIssue(
            issues,
            "high",
            `GSTR-3B ${index + 1} legal name mismatch`,
            `GSTR-3B legal name "${doc.extractedData.legalName || "-"}" did not match GST legal name "${gst.extractedData.legalName || "-"}".`
          );
        }
      }

      if (gst && doc.extractedData.tradeName) {
        const passed = compareNameField(gst.extractedData.tradeName, doc.extractedData.tradeName);
        checks.push({
          title: `GSTR-3B ${index + 1} trade name vs GST trade name`,
          passed,
          expected: gst.extractedData.tradeName || "-",
          actual: doc.extractedData.tradeName || "-",
        });
        if (!passed) {
          pushIssue(
            issues,
            "high",
            `GSTR-3B ${index + 1} trade name mismatch`,
            `GSTR-3B trade name "${doc.extractedData.tradeName || "-"}" did not match GST trade name "${gst.extractedData.tradeName || "-"}".`
          );
        }
      }

      if (!doc.extractedData.year || !doc.extractedData.period) {
        pushIssue(
          issues,
          "medium",
          `GSTR-3B ${index + 1} period details missing`,
          `The uploaded GSTR-3B document ${doc.originalname} did not contain a detectable year and period.`
        );
      }

      checks.push({
        title: `GSTR-3B ${index + 1} tax paid in cash sum > 0`,
        passed: Number(doc.extractedData.taxPaidInCashSum || 0) > 0,
        expected: "> 0",
        actual: String(doc.extractedData.taxPaidInCashSum || 0),
      });

      if (!(Number(doc.extractedData.taxPaidInCashSum || 0) > 0)) {
        pushIssue(
          issues,
          "high",
          `GSTR-3B ${index + 1} tax paid in cash is not greater than 0`,
          `The sum of 'Tax paid in cash' values in table 6.1 for ${doc.originalname} was ${doc.extractedData.taxPaidInCashSum || 0}.`
        );
      }
    });

  const gstr3bPeriods = extractedDocuments
    .filter((doc) => doc.key.startsWith("gstr3b_"))
    .map((doc) => normalizeText(`${doc.extractedData.period || ""} ${doc.extractedData.year || ""}`))
    .filter(Boolean);

  if (gstr3bPeriods.length) {
    const uniquePeriods = new Set(gstr3bPeriods);
    const passed = uniquePeriods.size === gstr3bPeriods.length;
    checks.push({
      title: "GSTR-3B uploaded periods are unique",
      passed,
      expected: String(gstr3bPeriods.length),
      actual: String(uniquePeriods.size),
    });

    if (!passed) {
      pushIssue(
        issues,
        "high",
        "Duplicate GSTR-3B periods detected",
        `Expected different GSTR-3B months, but found duplicates: ${gstr3bPeriods.join(", ")}.`
      );
    }
  }

  return checks;
}

function buildFaceChecks(faceResults, issues) {
  const checks = [];

  if (!faceResults || !faceResults.length) {
    return checks;
  }

  faceResults.forEach((result) => {
    if (result.error) {
      // Face could not be extracted — treat as a medium issue, not fatal
      checks.push({
        title: `Geo tag photo vs ${result.label} — face check skipped`,
        passed: false,
        expected: "Face detectable in both images",
        actual: result.error,
        isFaceCheck: true,
        faceResult: result,
      });

      issues.push({
        severity: "medium",
        title: `Face verification skipped for ${result.label}`,
        detail: `Automatic face comparison between the geo tag photo and ${result.label} could not run: ${result.error}`,
      });

      return;
    }

    const pct = Math.round((result.confidence || 0) * 100);

    checks.push({
      title: `Geo tag photo vs ${result.label} — face match`,
      passed: result.match,
      expected: "Same person (confidence ≥ 45%)",
      actual: result.match
        ? `Match confirmed — ${pct}% confidence`
        : `No match — ${pct}% confidence`,
      isFaceCheck: true,
      faceResult: result,
    });

    if (!result.match) {
      issues.push({
        severity: "high",
        title: `Face mismatch: geo tag photo vs ${result.label}`,
        detail: `The face in the geo tag photo does not match the face on the ${result.label} card. ` +
          `Similarity confidence: ${pct}% (threshold: 45%). ` +
          `Euclidean distance: ${result.distance !== null ? result.distance : "N/A"}. ` +
          `Manual verification of the vendor's identity is required.`,
      });
    }
  });

  return checks;
}


function finalizeValidation(submission, documents, extractedDocuments, faceResults) {
  const issues = [];
  const gstDocument = getDocumentByKey(extractedDocuments, "company_gst");
  const aadhaarDocument = extractedDocuments.find((doc) => doc.key.includes("aadhar")) || null;
  const panDocument = extractedDocuments.find((doc) => hasDocumentToken(doc.key, "pan")) || null;
  const chequeDocument = extractedDocuments.find((doc) => doc.key.includes("cheque")) || null;
  const gstBankDocument = extractedDocuments.find((doc) => doc.key.includes("gst_bank")) || null;
  const aadhaarName = normalizeText(aadhaarDocument && aadhaarDocument.extractedData.name);
  const gstName = normalizeText(gstDocument && gstDocument.extractedData.legalName);
  const trustedSharedName =
    aadhaarName && gstName && compareNameField(aadhaarName, gstName)
      ? gstName
      : gstName || aadhaarName;

  if (
    aadhaarDocument &&
    aadhaarDocument.identifiers.aadhaar &&
    trustedSharedName &&
    (isSuspiciousName(aadhaarDocument.extractedData.name) ||
      !compareNameField(aadhaarDocument.extractedData.name, trustedSharedName))
  ) {
    aadhaarDocument.extractedData.name = trustedSharedName;
  }

  if (
    panDocument &&
    panDocument.identifiers.pan &&
    (isSuspiciousName(panDocument.extractedData.name) ||
      (trustedSharedName && !compareNameField(panDocument.extractedData.name, trustedSharedName)))
  ) {
    panDocument.extractedData.name =
      (!isSuspiciousName(trustedSharedName) && trustedSharedName) ||
      panDocument.extractedData.name;
  }

  if (
    chequeDocument &&
    gstBankDocument &&
    isCloseDigitMatch(chequeDocument.extractedData.accountNumber, gstBankDocument.extractedData.accountNumber)
  ) {
    chequeDocument.extractedData.accountNumber = normalizeDigits(gstBankDocument.extractedData.accountNumber);
  }

  const msmeDocument = extractedDocuments.find((doc) => doc.key === "msme" || doc.key.endsWith("_msme")) || null;
  if (msmeDocument) {
    if (isMissingValue(msmeDocument.extractedData.typeOfOrganization) && gstDocument) {
      msmeDocument.extractedData.typeOfOrganization = normalizeText(gstDocument.extractedData.constitutionOfBusiness);
    }
    if (isMissingValue(msmeDocument.extractedData.enterpriseName) && gstDocument) {
      msmeDocument.extractedData.enterpriseName = normalizeText(gstDocument.extractedData.tradeName);
    }
    if (
      (isMissingValue(msmeDocument.extractedData.ownerName) ||
        compareNameField(msmeDocument.extractedData.ownerName, msmeDocument.extractedData.enterpriseName)) &&
      gstDocument
    ) {
      msmeDocument.extractedData.ownerName = normalizeText(gstDocument.extractedData.legalName);
    }
    if (
      (isMissingValue(msmeDocument.extractedData.officialAddress) ||
        !msmeDocument.extractedData.officialAddressParts ||
        !msmeDocument.extractedData.officialAddressParts.pincode) &&
      gstDocument
    ) {
      msmeDocument.extractedData.officialAddress = normalizeText(gstDocument.extractedData.address);
      msmeDocument.extractedData.officialAddressParts = parseAddress(msmeDocument.extractedData.officialAddress);
    }
    if (isWeakAccountNumber(msmeDocument.extractedData.bankAccountNumber)) {
      msmeDocument.extractedData.bankAccountNumber =
        normalizeDigits(chequeDocument && chequeDocument.extractedData.accountNumber) ||
        normalizeDigits(gstBankDocument && gstBankDocument.extractedData.accountNumber) ||
        msmeDocument.extractedData.bankAccountNumber;
    }
    if (isMissingValue(msmeDocument.extractedData.mobileNumber)) {
      msmeDocument.extractedData.mobileNumber = normalizeDigits(submission && submission.phone);
    }
    if (isMissingValue(msmeDocument.extractedData.email)) {
      msmeDocument.extractedData.email = normalizeEmail(submission && submission.email);
    }
  }

  const requiredFields = ["name", "phone", "email", "constitution", "vendorType", "product"];

  requiredFields.forEach((field) => {
    if (!normalizeText(submission[field])) {
      pushIssue(
        issues,
        "high",
        `Missing form field: ${field}`,
        `The submission did not include a value for "${field}".`
      );
    }
  });

  if (!documents.length) {
    pushIssue(
      issues,
      "high",
      "No documents uploaded",
      "The vendor submission reached the backend without any files attached."
    );
  }

  extractedDocuments.forEach((document) => {
    if (
      isGeoDocumentKey(document.key) &&
      document.extractionStatus !== "success"
    ) {
      return;
    }

    if (document.extractionStatus === "skipped") {
      pushIssue(
        issues,
        "medium",
        `Unsupported file type for ${document.key}`,
        `${document.originalname} is not a PDF, so automatic reading was skipped.`
      );
      return;
    }

    if (document.extractionStatus !== "success") {
      const detail =
        document.extractionStatus === "partial"
          ? `${document.originalname} was readable, but no reliable structured fields could be extracted automatically.`
          : `${document.originalname} could not be read automatically. ${document.extractionError}`;
      pushIssue(
        issues,
        "medium",
        document.extractionStatus === "partial"
          ? `Low-confidence extraction: ${document.key}`
          : `Unreadable document: ${document.key}`,
        detail
      );
      return;
    }

    if (hasDocumentToken(document.key, "pan") && !document.identifiers.pan) {
      pushIssue(
        issues,
        "high",
        `PAN number not found in ${document.key}`,
        `The uploaded PAN document ${document.originalname} did not contain a detectable PAN number.`
      );
    }

    if ((document.key.includes("gst") || document.key.includes("gstr3b")) && !document.identifiers.gstin) {
      pushIssue(
        issues,
        "high",
        `GSTIN not found in ${document.key}`,
        `The uploaded GST-related document ${document.originalname} did not contain a detectable GSTIN.`
      );
    }

    if (document.key === "company_gst") {
      [
        ["legalName", "Legal Name"],
        ["tradeName", "Trade Name"],
        ["additionalPlacesOfBusiness", "Additional Places of Business"],
        ["constitutionOfBusiness", "Constitution of Business"],
        ["address", "Address"],
      ].forEach(([fieldKey, label]) => {
        if (!document.extractedData[fieldKey]) {
          pushIssue(
            issues,
            "medium",
            `${label} not found in ${document.key}`,
            `The GST Registration document ${document.originalname} did not contain a detectable ${label}.`
          );
        }
      });
    }

    if (document.key.includes("aadhar") && !document.identifiers.aadhaar) {
      pushIssue(
        issues,
        "medium",
        `Aadhaar number not found in ${document.key}`,
        `The uploaded Aadhaar document ${document.originalname} did not contain a detectable Aadhaar number.`
      );
    }

    if (document.key.includes("aadhar") && !document.extractedData.name) {
      pushIssue(
        issues,
        "medium",
        `Name not found in ${document.key}`,
        `The uploaded Aadhaar document ${document.originalname} did not contain a detectable name.`
      );
    }

    if (document.key.includes("aadhar") && !document.extractedData.dob) {
      pushIssue(
        issues,
        "medium",
        `DOB not found in ${document.key}`,
        `The uploaded Aadhaar document ${document.originalname} did not contain a detectable DOB.`
      );
    }

    if ((document.key === "cin" || document.key.endsWith("_cin")) && !document.identifiers.cin) {
      pushIssue(
        issues,
        "medium",
        `CIN not found in ${document.key}`,
        `The uploaded CIN document ${document.originalname} did not contain a detectable CIN.`
      );
    }

    if ((document.key === "msme" || document.key.endsWith("_msme")) && !document.identifiers.msme) {
      pushIssue(
        issues,
        "medium",
        `MSME number not found in ${document.key}`,
        `The uploaded MSME document ${document.originalname} did not contain a detectable UDYAM number.`
      );
    }

    if (document.key === "msme" || document.key.endsWith("_msme")) {
      [
        ["udyamNumber", "MSME Number"],
        ["classificationYear", "Classification Year"],
        ["enterpriseType", "Enterprise Type"],
        ["typeOfOrganization", "Type of Organization"],
        ["majorActivity", "Major Activity"],
        ["enterpriseName", "Enterprise Name"],
        ["ownerName", "Owner Name"],
        ["mobileNumber", "Mobile Number"],
        ["email", "Email"],
        ["gender", "Gender"],
        ["officialAddress", "Official Address of Enterprise"],
        ["bankIfsc", "Bank IFSC"],
        ["bankAccountNumber", "Bank Account Number"],
      ].forEach(([fieldKey, label]) => {
        if (!document.extractedData[fieldKey]) {
          pushIssue(
            issues,
            "medium",
            `${label} not found in ${document.key}`,
            `The uploaded MSME/Udyam document ${document.originalname} did not contain a detectable ${label}.`
          );
        }
      });
    }

    if (hasDocumentToken(document.key, "pan") && !document.extractedData.name) {
      pushIssue(
        issues,
        "medium",
        `Name not found in ${document.key}`,
        `The uploaded PAN document ${document.originalname} did not contain a detectable name.`
      );
    }

    if ((document.key.includes("cheque") || document.key.includes("gst_bank")) && !document.extractedData.accountNumber) {
      pushIssue(
        issues,
        "medium",
        `Account number not found in ${document.key}`,
        `The uploaded bank document ${document.originalname} did not contain a detectable account number.`
      );
    }

    if (document.key.startsWith("gstr3b_")) {
      if (!document.extractedData.legalName) {
        pushIssue(
          issues,
          "medium",
          `Legal name not found in ${document.key}`,
          `The uploaded GSTR-3B document ${document.originalname} did not contain a detectable legal name.`
        );
      }

      if (!document.extractedData.tradeName) {
        pushIssue(
          issues,
          "medium",
          `Trade name not found in ${document.key}`,
          `The uploaded GSTR-3B document ${document.originalname} did not contain a detectable trade name.`
        );
      }
    }
  });

  const gstins = [...new Set(extractedDocuments.map((doc) => doc.identifiers.gstin).filter(Boolean))];
  if (gstins.length > 1) {
    pushIssue(
      issues,
      "high",
      "GSTIN mismatch across uploaded documents",
      `Multiple GSTINs were detected: ${gstins.join(", ")}.`
    );
  }

  const pans = [...new Set(extractedDocuments.map((doc) => doc.identifiers.pan).filter(Boolean))];
  if (pans.length > 1) {
    pushIssue(
      issues,
      "high",
      "PAN mismatch across uploaded documents",
      `Multiple PAN numbers were detected: ${pans.join(", ")}.`
    );
  }

  const gstr3bDocuments = documents.filter((doc) => String(doc.fieldname || "").startsWith("gstr3b_"));
  if (gstr3bDocuments.length > 0 && gstr3bDocuments.length < 3) {
    pushIssue(
      issues,
      "medium",
      "Incomplete GSTR3B set",
      `Expected 3 GSTR3B uploads, but only received ${gstr3bDocuments.length}.`
    );
  }

  // NEW
  // ✅ NEW: Private Limited specific checks
  if (submission && submission.constitution === "Private Limited") {
    // Company PAN
    const companyPanDoc = extractedDocuments.find((doc) => doc.key === "company_pan") || null;
    if (!companyPanDoc) {
      pushIssue(issues, "high", "Company PAN not uploaded", "Company PAN is required for Private Limited vendors.");
    } else if (companyPanDoc.extractionStatus !== "success") {
      pushIssue(issues, "medium", "Company PAN unreadable", `${companyPanDoc.originalname} could not be read automatically.`);
    } else if (!companyPanDoc.identifiers.pan) {
      pushIssue(issues, "medium", "PAN number not found in company_pan", `${companyPanDoc.originalname} did not contain a detectable PAN number.`);
    }

    // CIN
    const cinDoc = extractedDocuments.find((doc) => doc.key === "cin" || doc.key.endsWith("_cin")) || null;
    if (!cinDoc) {
      pushIssue(issues, "high", "CIN certificate not uploaded", "CIN certificate is required for Private Limited vendors.");
    } else if (cinDoc.extractionStatus !== "success") {
      pushIssue(issues, "medium", "CIN certificate unreadable", `${cinDoc.originalname} could not be read automatically.`);
    } else if (!cinDoc.identifiers.cin) {
      pushIssue(issues, "medium", "CIN not found in CIN document", `${cinDoc.originalname} did not contain a detectable CIN number.`);
    }

    // CTO
    const ctoDoc = extractedDocuments.find((doc) =>
      doc.key === "cto" || doc.key.includes("_cto") ||
      doc.key === "cte" || doc.key.includes("_cte")
    ) || null;
    if (!ctoDoc) {
      pushIssue(issues, "high", "CTO certificate not uploaded", "CTO (Consent to Operate) is required for Private Limited vendors.");
    } else if (ctoDoc.extractionStatus !== "success") {
      pushIssue(issues, "medium", "CTO certificate unreadable", `${ctoDoc.originalname} could not be read automatically.`);
    } else {
      // Check expiry
      if (ctoDoc.extractedData && ctoDoc.extractedData.expiryDate) {
        try {
          const parts = ctoDoc.extractedData.expiryDate.split(/[\/\-]/);
          if (parts.length === 3) {
            const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            const expiry = new Date(`${year}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`);
            if (!isNaN(expiry.getTime()) && expiry < new Date()) {
              pushIssue(issues, "high", "CTO certificate expired", `CTO valid till ${ctoDoc.extractedData.expiryDate} has expired.`);
            }
          }
        } catch (_) {}
      }
    }
  }

	const validationChecks = buildValidationChecks(extractedDocuments, issues, submission);
	const faceChecks = buildFaceChecks(faceResults || [], issues);
	const allChecks = [...validationChecks, ...faceChecks];

  return {
    status: issues.length ? "needs_review" : "clear",
    issues,
    extractedDocuments,
	   // NEW
	validationChecks: allChecks,
	faceResults: faceResults || [],
    summary: {
      totalDocuments: documents.length,
      readableDocuments: extractedDocuments.filter((doc) => doc.extractionStatus === "success").length,
      partialDocuments: extractedDocuments.filter((doc) => doc.extractionStatus === "partial").length,
      unreadableDocuments: extractedDocuments.filter((doc) => doc.extractionStatus !== "success").length,
    },
  };
}

function validateSubmission(submission, documents, faceResults) {
  const extractedDocuments = documents.map((document) => buildDocumentMetadata(document, submission));
  return finalizeValidation(submission, documents, extractedDocuments, faceResults);
}

function validateExtractedDocuments(submission, extractedDocuments, faceResults) {
  const documents = (extractedDocuments || []).map((document) => ({
    fieldname: document.key,
    originalname: document.originalname,
    extractionStatus: document.extractionStatus,
    extractionError: document.extractionError,
    totalPages: document.totalPages,
  }));

  return finalizeValidation(submission, documents, extractedDocuments || [], faceResults);
}

module.exports = {
  buildDocumentMetadata,
  validateExtractedDocuments,
  validateSubmission,
};
