# Offline speech components

- sherpa-onnx runtime: https://github.com/k2-fsa/sherpa-onnx/releases/tag/v2.0.1
  (Apache-2.0; see SHERPA-ONNX-APACHE-2.0.txt).
- Downloaded Mandarin and English model: https://huggingface.co/GilgameshWind/X-ASR-zh-en
  (Apache-2.0). The unchanged 160 ms ONNX weights come from the
  [sherpa-onnx export](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2).
- ONNX Runtime 1.28.2 is redistributed from the upstream sherpa-onnx AAR;
  see ONNXRUNTIME-1.28.2-LICENSE.txt and ONNXRUNTIME-1.28.2-THIRD-PARTY.txt.
