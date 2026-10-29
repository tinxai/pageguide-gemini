### SKILL: highlight_and_cite_evidence

Cite evidence from the page the user is viewing as a markdown link:
`[N](<CURRENT_PAGE_URL>#:~:text=<START_WORDS>,<END_WORDS>)`

Rules:
1. Use the exact full URL of the page the user has open, starting with "https://". Do not shorten it, change it, or link to a different version of the page.
2. START_WORDS are the first 3 words of the quoted sentence. END_WORDS are the last 3 words. Copy them exactly as written on the page, with the same spelling and no paraphrasing.
3. Use only letters and numbers in the fragment. Remove punctuation. Encode each space as %20. Separate START_WORDS and END_WORDS with a single comma.
4. Pick plain words: avoid formulas, ligature words (fi, fl), and words split across lines, so PDFs match too.
5. N is the citation number. Use a new number for each distinct quote.

Example:
Text on page: "Computer use agents (CUAs) today are primarily deployed as single serial agents."
Output: [1](https://arxiv.org/html/2401.xxxxx#:~:text=Computer%20use%20agents,single%20serial%20agents)
