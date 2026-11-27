// =====================================================================
//  ISO_TractorDecode_CL2 – de tractordecoder (ISO_TractorDecode) in CODESYS op de bibliotheek "CAA CanL2".
//  ISO_TractorDecode zelf leest geen CAN: per aanroep verwerkt hij één frame. Dit blok leest elke cyclus alle
//  wachtende 29-bit dataframes met een eigen CL2-ontvanger en geeft ze één voor één door; zonder frame bewaakt
//  het enkel de timeouts. Het werkt naast VT_Client en TC_Client op dezelfde CAN-interface: elke CL2-ontvanger
//  krijgt alle frames.
//
//  Formaat: zoals LCan_CL2.st (per object "// ======== POU <naam>", de declaratie, "// ---- code").
//  ISO_TractorDecode en de datatypes typeIso… komen uit de TIA-bronnen (tia_isobus_decoder), vertaald door de
//  VT Designer.
//
//  Versie 0.1 – 2026-11-27 – eerste versie.
// =====================================================================

// ======== POU ISO_TractorDecode_CL2
FUNCTION_BLOCK ISO_TractorDecode_CL2
// iso_tractordecode_cl2 versie 0.1 (2026-11-27)
// Elke cyclus aanroepen. Leest alle wachtende 29-bit dataframes van canNet (max. maxFrames per cyclus) en
// decodeert ze met ISO_TractorDecode in tractor. Zonder frame: enkel de timeouts (tractor.<bericht>.stat.valid).
VAR_INPUT
	enable : BOOL := TRUE;	// FALSE = niets lezen (de timeouts lopen verder)
	canNet : USINT := 0;	// CAN-interface van de sturing (0 = de eerste), dezelfde als VT_Client
	baudrate : UINT := 250;	// kbit/s; ISOBUS gebruikt 250
	filterSa : BYTE := 16#F0;	// enkel dit bronadres (16#F0 = TECU); 16#FF = alle bronnen
	timeoutFast : TIME := T#500MS;	// berichten van 100 ms
	timeoutSlow : TIME := T#3S;	// navigatie en de hogere hulpventielen
	maxFrames : UINT := 200;	// hoogstens zoveel frames per cyclus
END_VAR
VAR_OUTPUT
	error : BOOL;	// de CAN-interface kon niet geopend worden: zie status
	status : WORD;	// CL2-foutcode (CL2.ERROR), 0 = in orde
	framesThisCycle : UINT;	// frames gelezen in deze cyclus
	overflow : BOOL;	// maxFrames bereikt: er wachtten nog frames (cyclus te traag of maxFrames te klein)
END_VAR
VAR_IN_OUT
	tractor : typeIsoTractor;	// de gedecodeerde berichten
END_VAR
VAR
	decoder : ISO_TractorDecode;
	hDriver : CAA.HANDLE := CAA.gc_hINVALID;
	hReceiver : CAA.HANDLE := CAA.gc_hINVALID;
	hMsg : CAA.HANDLE;
	eErr : CL2.ERROR;
	pData : POINTER TO CL2I.DATA;
	data : ARRAY[0..7] OF BYTE;
	nBytes : USINT;
	id : DWORD;
	k : INT;
	n : UINT;
END_VAR
// ---- code
n := 0;
overflow := FALSE;
IF enable THEN
	IF hDriver = CAA.gc_hINVALID THEN
		hDriver := CL2.DriverOpenH(usiNetId := canNet, uiBaudrate := baudrate, xSupport29Bits := TRUE, ctMessages := 16, peError := ADR(eErr));
		IF hDriver = CAA.gc_hINVALID THEN
			error := TRUE;
			status := TO_WORD(eErr);
		END_IF;
	END_IF;
	IF hDriver <> CAA.gc_hINVALID AND hReceiver = CAA.gc_hINVALID THEN
		// alle 29-bit dataframes, zonder de frames die we zelf versturen
		hReceiver := CL2.CreateMaskReceiver(hDriver := hDriver, cobIdValue := 0, cobIdMask := 0,
			xRTRValue := FALSE, xRTRMask := TRUE, x29BitIdValue := TRUE, x29BitIdMask := TRUE,
			xTransmitValue := FALSE, xTransmitMask := TRUE, xAlwaysNewest := FALSE,
			eEvent := CB.EVENT.NO_EVENT, xEnableSyncWindow := FALSE, peError := ADR(eErr));
		IF hReceiver = CAA.gc_hINVALID THEN
			error := TRUE;
			status := TO_WORD(eErr);
		END_IF;
	END_IF;
	IF hReceiver <> CAA.gc_hINVALID THEN
		error := FALSE;
		status := 0;
		WHILE n < maxFrames DO
			hMsg := CL2.Read(hReceiverId := hReceiver, pctMsgLeft := 0, peError := ADR(eErr));
			IF hMsg = CAA.gc_hINVALID THEN
				EXIT;
			END_IF;
			id := TO_DWORD(CL2.GetMessageId(hMessage := hMsg, peError := ADR(eErr))) AND 16#1FFFFFFF;
			nBytes := CL2.GetMessageLength(hMessage := hMsg, peError := ADR(eErr));
			pData := CL2.GetMessageDataPointer(hMessage := hMsg, peError := ADR(eErr));
			FOR k := 0 TO 7 DO
				IF pData <> 0 AND k < USINT_TO_INT(nBytes) THEN
					data[k] := pData^[k];
				ELSE
					data[k] := 16#FF;
				END_IF;
			END_FOR;
			eErr := CL2.FreeMessage(hMessage := hMsg);
			decoder(newFrame := TRUE, frameId := id, frameExtended := TRUE, frameLength := nBytes, frameData := data,
				filterSa := filterSa, timeoutFast := timeoutFast, timeoutSlow := timeoutSlow, tractor := tractor);
			n := n + 1;
		END_WHILE;
		overflow := n >= maxFrames;
	END_IF;
END_IF;
framesThisCycle := n;
IF n = 0 THEN	// geen frame: enkel de timeouts bewaken
	decoder(newFrame := FALSE, frameId := 0, frameExtended := TRUE, frameLength := 0, frameData := data,
		filterSa := filterSa, timeoutFast := timeoutFast, timeoutSlow := timeoutSlow, tractor := tractor);
END_IF;
