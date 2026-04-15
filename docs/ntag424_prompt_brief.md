## 17. Condensed “prompt-ready” context for another LLM

Use this block directly as a coding brief:

> You are implementing a reader/writer for **NTAG 424 DNA**. Separate the design into **two subsystems**:  
> **(A) provisioning/admin over EV2 secure messaging**, and  
> **(B) backend/client-side verification of SDM/SUN dynamic NDEF output**.  
>
> For provisioning/admin, support: ISO activation hooks, ISO SELECT of the NFC Forum Type 4 NDEF application (`D2760000850101`), `GetVersion`, `GetFileSettings`, `AuthenticateEV2First`, `AuthenticateEV2NonFirst`, `WriteData`, `ChangeFileSettings`, `ChangeKey`, `SetConfiguration`, `GetCardUID`, and optionally `Read_Sig`.  
>
> Model authenticated session state explicitly with: `TI`, `CmdCtr`, `KSesAuthENC`, `KSesAuthMAC`, current authenticated key number, and auth mode (`EV2First` / `EV2NonFirst`). Implement `CommMode.Plain`, `CommMode.MAC`, and `CommMode.Full`. Centralize command wrapping and response verification. In Full mode, use the EV2 IV derivation pattern shown in the app note (`A55A || TI || CmdCtr ...` for command encryption and `5AA5 || TI || CmdCtr+1 ...` for response-side decryption).  
>
> Do not mix up byte order. Multi-byte command parameters such as offsets and lengths are commonly **LSB-first** in APDU payloads, while cryptographic values, keys, `TI`, random numbers, and MACs are treated **MSB-first**.  
>
> Implement CMAC truncation exactly as shown by NXP: the 8-byte MAC token is derived from the full 16-byte CMAC by taking alternating bytes in the defined order. Put this in one tested helper.  
>
> For SUN/SDM verification, assume the NDEF file may contain ASCII-hex mirrored values for UID, `SDMReadCtr`, encrypted PICC data (`PICCENCData`), encrypted file data (`SDMENCFileData`), and `SDMMAC`. Build a configuration-driven verifier that can parse the dynamic URL/template, recover UID and counter (either directly or by decrypting `PICCENCData`), derive SDM session keys, optionally decrypt mirrored file data, reconstruct the exact ASCII MAC input slice, compute `SDMMAC`, and reject replayed counters.  
>
> Keep **SDM KDF logic separate from SSM KDF logic**. For SDM, derive `KSesSDMFileReadENC` and `KSesSDMFileReadMAC` from the SDM file read key using the UID and `SDMReadCtr` per the application note examples. Do not reuse EV2 auth-session derivation blindly.  
>
> The worked personalization flow in AN12196 is a good implementation blueprint: activate card, optionally verify originality signature, select NDEF app, inspect file settings, authenticate with key `0x00`, build and write NDEF, change NDEF file settings to enable SDM, authenticate with other keys as needed, write proprietary file, update CC file, and rotate default keys.  
>
> Treat **Random ID** and **LRP enablement** as irreversible. When Random ID is enabled, the anticollision UID is not the real card UID; use authenticated `GetCardUID` to retrieve the permanent UID.  
>
> Build the implementation around strong test vectors using the note’s examples for authentication, `GetFileSettings`, `WriteData`, `ChangeFileSettings`, `ChangeKey`, `PICCENCData` decryption, and `SDMMAC` verification.

---