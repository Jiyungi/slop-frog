# Bouncer Deep Gap Analysis

**Research snapshot:** July 18, 2026  
**Purpose:** Understand what Imbue's Bouncer can actually do, how strong the published evidence is, and what product space remains open for Slop Frog.

## Executive conclusion

Bouncer is best understood as a **personal feed-control product with AI-content detection added as one filtering signal**. It is not a universal AI-authenticity checker.

Its strongest demonstrated capabilities are:

- semantic filtering of an X feed using natural-language rules;
- dedicated detection of English AI-generated and AI-edited text;
- fast, private, on-device text detection on recent iPhones;
- server-side AI-image detection;
- hiding content automatically while preserving a review list;
- open-source client code and reproducible text-detector training code.

Its largest gaps are:

- no actual video or audio detection;
- no provenance or Content Credentials verification;
- no public, shareable verdict or community consensus;
- no explanation of *which evidence* made content look synthetic;
- limited evidence for multilingual, short-form, out-of-domain, and newly released generator performance;
- no published image-detector model, dataset, detailed benchmark, or weights in the linked detector repository;
- browser AI detection depends on Imbue's private backend;
- non-commercial licensing limits direct product reuse.

The clearest opportunity is therefore **not to rebuild Bouncer's feed filter**. It is to build an evidence and accountability layer that Bouncer does not provide: a user can submit any post, image, or video and receive a transparent, contestable label combining provenance, specialized detectors, and community review.

---

## 1. What Bouncer is

Bouncer is an open-source browser extension and iOS app for filtering social feeds. A user writes a plain-language instruction such as “crypto,” “rage politics,” or “AI slop.” Bouncer evaluates feed items and hides matches. Its original product goal is control over attention, not forensic authorship attribution.

The current public product page describes support for X. The repository contains LinkedIn and YouTube adapters, but the active browser manifest configuration currently registers only X. This means code for other platforms exists, but it should not be treated as a currently shipped, generally available capability.

There are three separate detector paths in the current code:

1. **General filter:** an LLM determines whether a post matches the user's natural-language filters.
2. **AI-text detector:** a purpose-trained classifier returns a continuous AI-assistance score.
3. **AI-image detector:** a purpose-trained image classifier returns a synthetic-image score.

The client runs these paths in parallel. Any detector that says “hide” can end the decision race. Results are cached, and the user can review filtered content.

This architecture is effective for feed cleanup, but the output is an action—**hide or keep**—rather than a defensible authenticity finding.

## 2. What the text detector can do

### Architecture

The hosted detector uses QLoRA on `Qwen/Qwen3-4B`. The base model is loaded in 4-bit NF4 form, with rank-8 LoRA adapters applied to attention and MLP projections. A small classification head reads the last non-padding token's hidden state and predicts one of four edit-intensity buckets.

The detector's public output is a continuous score between 0 and 1, calculated from the expected edit-intensity bucket. Bouncer applies a client-side threshold to convert that score into a hide/keep decision.

The iPhone version reuses the Gemma 4 E2B backbone already used for ordinary feed filtering. It conditionally applies a roughly 10 MB LoRA adapter and a roughly 40 KB classifier head. Imbue reports about 120 ms per tweet on an iPhone 18. This is genuinely interesting engineering: one quantized backbone serves both generation/classification and AI-text detection without loading two multi-billion-parameter models.

### Training data

The released dataset contains 86,208 rows:

- 75,316 training rows;
- 3,234 validation rows;
- 7,658 test rows.

It is divided approximately evenly among human-written, AI-edited, and AI-generated text. The human sources are English texts from Amazon, Yelp, Reddit writing prompts, FineWeb-EDU, news datasets, and Twitter. The human material predates ChatGPT.

Three model families generate the synthetic material:

- Claude Sonnet 4.6;
- GPT-5.3 Chat;
- Gemini 3 Flash.

For AI-edited examples, models apply one of hundreds of editing instructions to human source text. For AI-generated examples, models receive extracted topic/metadata and a target length, then generate a fresh item. The supervision signal is cosine distance between the output and its human source, bucketed into four edit-intensity classes.

### Published performance

Imbue reports the following results on its held-out test set:

| Task | Hosted Qwen | On-device Gemma |
|---|---:|---:|
| Human vs. fully AI-generated | 99.8% | 99.6% |
| Human vs. AI-edited or generated | 95.5% | 93.3% |
| Fully AI-generated vs. human or edited | 96.2% | 94.8% |
| Human / AI-edited / AI-generated | 91.7% | 88.2% |

The 99.8% headline excludes all AI-edited rows, reducing the test set from 7,658 to 5,105 examples. The harder and more realistic result is therefore the three-way score or the human-vs-rest score.

Imbue also reports 96.4% accuracy and a 0.10% false-positive rate on RAID, despite not training on RAID's generator models. This is promising external-benchmark evidence, but the detector repository does not currently include a RAID evaluation script, exact RAID subset/configuration, decoding-condition breakdown, attack-by-attack results, or generated prediction file. The claim is therefore not as independently auditable as the in-distribution test result.

## 3. What the image detector can do

Imbue says its image detector uses a fine-tuned 7-billion-parameter DINOv3 backbone with a classification head. It was derived from techniques used in the NTIRE 2026 AI-image-detection challenge. Training includes images from multiple generators and augmentations intended to simulate social-media transformations such as cropping, blur, and compression.

The model runs server-side because it is too large for current consumer-device deployment. Bouncer sends each post image to the detector, receives one synthetic probability per image, and uses the maximum score as the post-level confidence.

This supports one useful question: **“Does at least one image attached to this post look AI-generated?”**

It does not establish:

- who generated the image;
- which model generated it;
- whether the image was merely edited;
- which region was altered;
- whether a real image was placed in an AI-generated frame;
- whether provenance metadata contradicts or supports the classifier;
- whether the visual claim in the image is factually true.

Unlike the text detector, the linked open-source detector repository currently contains no image-model training code, model card, weights, dataset manifest, confusion matrix, or detailed benchmark table. The blog explains the approach but publishes no numeric image-detection result. This is the largest evidence gap in the newly announced capability.

## 4. What Bouncer cannot currently do

### It does not detect AI video

The presence of a YouTube adapter can be misleading. That adapter extracts a video's title, channel information, metadata, and thumbnail for feed filtering. It does not download or inspect video frames, analyze motion, check lip synchronization, inspect audio, or classify a transcript as synthetic.

A thumbnail detector is not a video detector. A real thumbnail can front an AI-generated video, and an AI thumbnail can front a human-made video.

### It does not provide provenance

Bouncer performs inference from content patterns. It does not appear to validate C2PA Content Credentials, cryptographic signatures, camera attestations, generator manifests, or editing histories.

This matters because a classifier answers “what does this resemble?” while provenance answers “what process produced this file?” They are complementary, not interchangeable.

### It does not provide a public label

Bouncer's verdict is private and personalized. It hides content for the individual user. It does not attach a public label to the original post, publish a shareable evidence page, or allow other people to agree, disagree, or add context.

### It does not produce forensic explanations

The production UI reports conclusions such as “Text looks like AI” or “Image looks like AI.” The numeric score is hidden outside development builds. The classifier does not expose token-level evidence, suspicious regions, alternative hypotheses, or provenance signals.

The product's “reasoning transparency” applies most naturally to its general LLM filter. A discriminative score from the dedicated detector is not itself a human-readable explanation.

### It does not cover short text reliably

The training pipeline excludes texts under 20 words. The live browser code also skips the text detector for main posts under 20 words and replies under 10 words. This is sensible risk control, but it leaves a major part of social media uncovered: captions, memes, slogans, comments, and short replies.

### It does not establish broad language coverage

The released text dataset is English. No multilingual benchmark is reported. A current open issue also documents an extension UI problem on non-English X locales, reinforcing that internationalization is not yet a proven strength.

### It does not offer a commercial detector foundation

The detector code, weights, and dataset are licensed CC BY-NC-SA 4.0. They are useful for research and a nonprofit hackathon prototype, but they cannot simply become the core of a commercial product without separate permission. The Bouncer application itself uses AGPL-3.0, creating a different set of source-sharing obligations.

## 5. Evaluation and evidence gaps

### 5.1 The easiest case drives the headline

“99.8% accurate” describes human text versus fully generated text after removing the ambiguous AI-edited class. This is a valid metric but not the product's most common hard case. Real users copy, edit, summarize, autocomplete, translate, and partially rewrite content.

### 5.2 Generator coverage is narrow

The internal dataset uses three frontier generator families. It does not demonstrate performance on the long tail of open-weight models, fine-tunes, local models, specialized writing tools, or models released after training.

The RAID result helps, but reproducible per-model and per-attack results are needed to understand where that generalization holds.

### 5.3 Domain coverage is still synthetic

The dataset includes six useful domains, including Twitter, but its AI rows are generated through a controlled mirroring pipeline. That differs from naturally occurring social content shaped by prompting, copy-paste, collaborative editing, screenshots, slang, platform trends, and deliberate evasion.

No published evaluation uses a fresh, naturally sampled feed with human adjudication and real-world class prevalence.

### 5.4 Test prevalence is unrealistic

The evaluation dataset is balanced across human, edited, and generated text. A live feed may contain far less AI content. Even a low false-positive rate can produce many incorrect accusations when the true base rate is low. Product evaluation should therefore report precision at realistic prevalence, not only accuracy and macro F1 on a balanced dataset.

### 5.5 Thresholds optimize a benchmark objective

Binary thresholds are selected on validation data by maximizing F1, then applied to test data. This is standard, but it does not encode the asymmetric harm of falsely accusing a human author. A public labeling product should generally target a strict false-positive ceiling or expose an “uncertain” region rather than optimize a single balanced F1 score.

### 5.6 The ternary evaluation peeks at test-set range

The released ternary evaluator independently min-max scales the validation scores and the test scores using each split's own minimum and maximum. That means test-distribution information influences the transformation applied before classification. It does not use test labels, but it is still a transductive evaluation choice and can make deployment reproduction less faithful, because a live system does not know the future population's score range.

A stricter evaluation would freeze all scaling parameters and both thresholds from validation data, then apply them unchanged to every test example.

### 5.7 The score is not proven to be a probability

The model emits a normalized expected bucket score. The client code refers to it as a probability in development-facing text, but no reliability diagram, expected calibration error, Brier score, or temperature-calibration procedure is published. A score of 0.8 should not automatically be communicated as “80% probability this is AI.”

### 5.8 Image evidence is underpublished

The image detector needs at minimum:

- generator-disjoint evaluation;
- real-camera source diversity;
- per-generator and per-transformation metrics;
- false-positive rates at operating thresholds;
- tests on screenshots, memes, composites, resaves, and social-platform recompression;
- tests against adaptive laundering;
- a public model card and representative test set.

## 6. Product and trust gaps

### Binary hiding is too aggressive for uncertain evidence

Bouncer's action model is appropriate for personal preference: a false positive briefly hides something the user can restore. The same error would be much more harmful in a public authenticity product, where a label can damage credibility.

A public system needs at least four states:

- verified provenance;
- likely AI-generated;
- mixed or AI-edited;
- inconclusive.

“Human-generated” should be used very cautiously because absence of evidence is not evidence of human authorship.

### There is no contestability system

A creator cannot attach original files, signing credentials, edit history, or other counter-evidence to a Bouncer verdict. There is no public appeal record or versioned decision trail.

### There is no community intelligence

Users can review their own filtered posts and submit feedback, but there is no cross-user consensus, reputation system, expert escalation, or mechanism similar to Community Notes. The tool therefore cannot accumulate social evidence around a specific viral item.

### Privacy messaging needs finer distinctions

Local iPhone text detection is a strong privacy feature. Browser image detection and hosted text detection use Imbue services. The source also contains an Imbue-build path that can send feed contents to the server for analytics even when no filters are configured. This does not prove collection of identifying data, but it shows why “local,” “sent for inference,” “logged,” and “used for analytics” should be disclosed separately rather than collapsed into a simple private/not-private claim.

## 7. The open space for Slop Frog

### Proposed position

**Slop Frog is a community evidence layer for AI-generated media.**

Instead of silently hiding content, it creates a transparent report that answers:

1. What automated detectors say.
2. Whether trusted provenance metadata exists.
3. What humans reviewing the item believe.
4. How confident the combined system should be.
5. What evidence could change the verdict.

This is differentiated from Bouncer in objective, interaction, and output.

| Dimension | Bouncer | Slop Frog opportunity |
|---|---|---|
| Primary goal | Personal feed control | Shared authenticity assessment |
| Main action | Hide content | Label and explain content |
| Audience | Individual feed user | Viewers, creators, researchers, moderators |
| Scope | Primarily X feed items | Any submitted post, image, or video URL |
| Evidence | Model scores | Provenance + detectors + community review |
| Output | Private hide/keep decision | Public, versioned, shareable report |
| Disagreement | User restores a post | Review, appeal, and consensus process |
| Learning loop | Private feedback | Auditable labeled dataset |

### High-value capabilities Bouncer leaves open

#### 1. Evidence cards instead of verdict-only labels

Every analysis should show separate signals rather than one magical percentage:

- C2PA/provenance found or absent;
- text-detector score;
- image-detector score;
- video-frame consistency score;
- audio/deepfake score;
- community vote and reviewer diversity;
- known limitations and an uncertainty state.

#### 2. Video-native analysis

A credible video pipeline can sample frames, detect scene changes, inspect faces, analyze audio, transcribe speech, evaluate the transcript, and check metadata/provenance. Even a hackathon prototype that analyzes three frames plus a transcript demonstrates a capability Bouncer does not have.

#### 3. Community consensus

Avoid simple majority voting, which is easy to brigade. Use:

- reviewer reputation based on later-confirmed cases;
- required reasons or evidence;
- “AI / mixed / human-origin evidence / unsure” options;
- cross-group agreement rather than raw vote count;
- expert review for high-reach disputed items;
- visible decision history.

#### 4. Appeals and creator evidence

Allow a creator to submit the original file, Content Credentials, project timeline, source frames, or edit history. Preserve both the initial result and any revision.

#### 5. A real-world benchmark commons

Build an opt-in dataset of naturally occurring, disputed content with provenance-backed or strongly adjudicated labels. Measure performance by language, generator, content length, transformation, platform, and time. This dataset may become more valuable than the first detector.

## 8. Recommended hackathon wedge

Do not attempt to train a new 4B model during the hackathon. Build the missing trust workflow around available signals.

### MVP

1. User pastes a post or uploads an image/video.
2. The app records the content hash so repeated submissions map to one case.
3. It checks available provenance metadata.
4. It runs one existing text or image detector.
5. Reviewers vote `AI`, `mixed/edited`, `not enough evidence`, or `human-origin evidence` and provide a reason.
6. The app produces a shareable evidence card with separate machine and community sections.

### Best demo story

Analyze three deliberately chosen cases:

- obvious AI-generated content;
- real human content with polished “AI-like” style;
- mixed or edited content where a binary detector is misleading.

The third case proves the need for Slop Frog: detection is not only a model-accuracy problem; it is an evidence, uncertainty, and governance problem.

### Success metric

The hackathon prototype succeeds if a viewer can understand **why** a case received its label and can challenge it. It does not need to claim that the label is infallible.

## 9. Questions worth testing next

1. How does the released Qwen detector perform on short, current, naturally sampled X posts?
2. Does the RAID result include all attacks, domains, decoding strategies, and human examples?
3. What threshold produces a false-positive rate acceptable for public labeling rather than private filtering?
4. How quickly does performance decay on generator models released after training?
5. Can the image detector distinguish fully generated images from localized AI edits?
6. Can social-media recompression or a screenshot reliably evade it?
7. What exact feed content is retained or logged by the hosted inference and analytics paths?
8. What community-consensus rule resists brigading while remaining understandable?
9. Which kinds of creator evidence should override or downgrade a detector result?
10. Can a content hash and canonicalization scheme match reposts after crops, captions, and compression?

## 10. Bottom line

Bouncer demonstrates that compact, specialized detectors can be surprisingly effective and even run locally. Its reported RAID result makes the work more credible than a detector evaluated only on its own synthetic split.

But Bouncer solves **personal removal**, not **public truth**. It does not establish provenance, inspect full video, coordinate human judgment, expose robust evidence, or support contestable public labels. Those are not minor missing features; they define a different product category.

Slop Frog should occupy that category.

---

## Primary sources

- [Imbue: Bouncer—Leveraging Local Compute to Detect AI Slop](https://imbue.com/blog/bouncer-leveraging-local-compute-to-detect-ai-slop)
- [Imbue: Bouncer product page](https://imbue.com/product/bouncer/)
- [Imbue Bouncer application repository](https://github.com/imbue-ai/bouncer)
- [Imbue AI-detection training and evaluation repository](https://github.com/imbue-ai/ai-detection-demo)
- [Released AI-detection dataset](https://huggingface.co/datasets/DarrenJiaImbue/ai-detection-demo-dataset)
- [Released Qwen detector adapter](https://huggingface.co/DarrenJiaImbue/ai-detection-demo-qwen_3_4b)
- [RAID benchmark paper](https://arxiv.org/abs/2405.07940)
- [Bouncer issue: non-English locale UI failure](https://github.com/imbue-ai/bouncer/issues/55)
- [Bouncer pull request temporarily removing YouTube from iOS](https://github.com/imbue-ai/bouncer/pull/68)

## Evidence labels used in this report

- **Published fact:** stated in Imbue's documentation, code, model card, or dataset card.
- **Code-audit finding:** directly observed in the public repositories as of the snapshot date.
- **Inference:** a product implication derived from the published architecture; it should be tested before being presented as measured fact.
