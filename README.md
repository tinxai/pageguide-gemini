<p align="center">
  <a href="https://pageguide.github.io"><img src="assets/branding/orange-gemini-logo.svg" alt="Orange and Gemini" width="360"></a>
</p>

<h1 align="center">PageGuide Gemini</h1>

<p align="center"><strong><a href="https://pageguide.github.io">Visit the PageGuide website</a></strong></p>

A Chrome extension for Gemini in Chrome. When you click a citation link in a Gemini answer, it switches to the tab you already have open for that page instead of opening a duplicate, then scrolls to and highlights the cited text.

![Demo: clicking citation 1 in the Gemini side panel highlights the evidence on the page](docs/demo.png)

Click a citation in the Gemini panel (right) and the evidence is highlighted on the page (left).

## Install the extension

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Reload any tabs you want highlighted, including the Gemini tab.

## Add the skill to Gemini

Gemini needs to format its citations in a way the extension can read. The format is in [`GEMINI_SKILL.md`](GEMINI_SKILL.md).

1. Open Gemini in Chrome and click the **+** button in the prompt box.

   ![Open the skill repo](docs/open-skill-repo.png)

2. Click **Skills**.

   ![Skills menu](docs/step-skills-menu.png)

3. Click **Manage skills**.

   ![Manage skills](docs/step-manage-skills.png)

4. On the **Your skills** page, click **Add**.

   ![Your skills page](docs/step-your-skills.png)

5. In the **Add skill** form, enter `pg` as the **Name**, paste the contents of `GEMINI_SKILL.md` into **Instructions**, and click **Save**. This **Name** field controls the skill command.

   ![Add skill form](docs/step-add-skill.png)

6. When you ask a question about a page, click **+**, then **Skills**, then **pg**, or type `$pg` in the prompt box.

## Use it

1. Open the page or paper you want to read (for example an arXiv paper) in a tab.
2. Share that tab with Gemini and ask a question with the skill enabled.
3. Click a citation like `[1]` in the answer.
4. The extension jumps to your open tab and highlights the quoted text.

## Visual evidence

For things that aren't text (an object in a photo, a spot on a map, a region of a chart), the skill makes Gemini give a box instead of a quote. The extension finds the image, map, or canvas on the page, scrolls to it, and draws the box, arrow, and a short label over it. This works best for images and charts. On maps and canvases the box is only right if you haven't panned or zoomed since Gemini looked.

## Use cases

### 1. Find evidence on the page you are reading

Ask Gemini a question about the page you have open. Each statement in its answer ends with a numbered citation. Click it and the extension scrolls to the exact text, highlights it, and points an arrow at it with an "Evidence N" sign. It works on long posts and articles, and on pages built with shadow DOM, such as social feeds. Here, a citation on an X post jumps to the sentence it came from.

![Find evidence: a citation highlights the cited sentence in an X post](docs/usecase-find-evidence.png)

### 2. Navigate, then draw on an image

Give Gemini a browsing task, such as "scroll down and find the photo of Harry Kane and tell me what he is wearing". Gemini navigates to the picture, and its answer cites what it saw with a box. Click the citation and the extension draws a bounding box, an arrow, and a short label directly on the image. This also works for maps, charts, and video frames, not only text.

![Navigate and draw: a citation draws a labelled box on the photo](docs/usecase-navigate-image.png)

## Notes

- **Webpages:** the extension highlights the quote itself; clicking another citation replaces the previous highlight. It also draws a pulsing box, a bobbing arrow and an "Evidence N" sign on the quote, which fade out after a few seconds.
- **Google Docs, Sheets, and Slides:** these editors draw content on canvases instead of exposing normal webpage text. PageGuide keeps the same tab but switches it to Google's text-readable view so it can highlight the cited words.
- **PDFs:** Chrome's PDF viewer blocks extension scripts, so Chrome highlights the quote itself. Each click opens the PDF fresh and closes the old tab, so only the latest quote is highlighted.
- If a quote isn't highlighted, the words in the citation probably don't match the page text exactly. Pages where text is drawn as an image can't be highlighted.

## Author

Made by [Tin Nguyen](https://github.com/tinxai). It builds on ideas from [PageGuide](https://github.com/tinxai/pageguide).

## License

[MIT](LICENSE) © 2026 Tin Nguyen
