# Imbue Bouncer Detector Assets

Slop Frog uses local inference only for the MVP. The model artifacts below are
downloaded outside version control to `local-detector/models/imbue/`.

## Qwen local detector

This is the full-strength Imbue detector suitable for the local Python service.

| Role | Repository | Pinned revision | Local path |
| --- | --- | --- | --- |
| Base model | `Qwen/Qwen3-4B` | `1cfa9a7208912126459214e8b04321603b3df60c` | `qwen_3_4b_base/` |
| Detector adapter and score head | `DarrenJiaImbue/ai-detection-demo-qwen_3_4b` | `1122ecd1b1b19ee0b147e862f204acdc1ad98dc3` | `qwen_3_4b/` |
| Inference implementation | `imbue-ai/ai-detection-demo` | `b94beedea9dda6eeef8b668a952faa1c7f6e9e34` | `ai-detection-demo/` |

The Qwen adapter contains the LoRA weights and its `NormedLinear` four-bucket
score head through PEFT's `modules_to_save=["score"]` convention. There is no
separate controller artifact to fetch for this model.

## Gemma on-device detector

This is Imbue's LiteRT-LM iPhone deployment, not the Python FastAPI model.

| Artifact | Repository | Pinned revision | Local path |
| --- | --- | --- | --- |
| LiteRT-LM bundle, LoRA adapter, and classifier head | `DarrenJiaImbue/gemma-4-e2b-ai-text-detector-v2` | `73a449902192b9d2db6927446c9eb1a3ce665471` | `gemma_4_e2b_detector/` |

The Gemma snapshot contains all three runtime artifacts:
`model.litertlm`, `lora_adapter.tflite`, and `head.tflite`.

## License

Imbue publishes its detector code and weights under CC BY-NC-SA 4.0. Use is
therefore limited to a non-commercial, share-alike prototype unless separate
permission is obtained.
