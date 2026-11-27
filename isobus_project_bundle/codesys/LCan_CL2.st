// =====================================================================
//  LCan_CL2 – de CAN-laag van VT_Client en TC_Client in CODESYS.
//  Dezelfde blokken als de Siemens-bibliotheek LCan (ET 200SP CM CAN), maar op de standaard-
//  bibliotheek "CAA CanL2" van CODESYS (namespace CL2), zodat de vertaalde VT_Client en TC_Client
//  ongewijzigd werken:
//    - LCan_SetTransparentFilter: bewaart de filterlijst van een "receive proxy" (proxyIndex);
//    - LCan_RcvTransparentMessage: één 29-bit dataframe per handshake (ackMessage), door die lijst;
//    - LCan_SendTransparentMessage: één frame per stijgende flank van execute.
//  Werkt de sturing niet met CL2 (bv. enkel een eigen CAN-bibliotheek van de fabrikant), dan is
//  dit het enige bestand dat aangepast moet worden.
//
//  Formaat: per object een regel "// ======== <DUT|GVL|POU> <naam>", de declaratie, en bij een POU
//  na "// ---- code" de implementatie. De VT Designer leest dit bestand en zet het mee in de
//  PLCopen XML; in CODESYS plak je per object de declaratie en de code.
//
//  Versie 0.3 – 2026-11-27 – tekens van een tekst via een pointer (Strg_Byte, Chars_TO_Strg): de index op een STRING
//  gaf in CODESYS telkens het eerste teken ('GEREED' werd GGGGGG op de VT).
//  Versie 0.2 – 2026-11-27 – elke ingang van de CAA-functies ingevuld (CODESYS laat er geen weg), eEvent := CB.EVENT.NO_EVENT.
//  Versie 0.1 – 2026-11-26 – eerste versie.
// =====================================================================

// ======== DUT LCan_typeTransparentFilter
TYPE LCan_typeTransparentFilter :
STRUCT
	ignoreFilter : BOOL := TRUE;	// TRUE = deze regel niet gebruiken
	messageFilter : USINT;	// 0 = data en RTR, 1 = enkel data, 2 = enkel RTR (hier altijd enkel data)
	messageIdFormat : USINT;	// 0 = 11 en 29 bit, 1 = enkel 11 bit, 2 = enkel 29 bit (hier altijd 29 bit)
	messageId : DWORD;	// identifier die doorgelaten wordt
END_STRUCT
END_TYPE

// ======== DUT LCan_typeFilterList
TYPE LCan_typeFilterList :
STRUCT
	count : USINT;	// gebruikte regels in id
	id : ARRAY[0..15] OF DWORD;	// doorgelaten 29-bit identifiers
	valid : BOOL;	// lijst gezet met LCan_SetTransparentFilter
END_STRUCT
END_TYPE

// ======== GVL LCan_CL2
// Filterlijsten per CAN-interface en per proxyIndex (zoals de receive proxy's van de CM CAN).
{attribute 'qualified_only'}
VAR_GLOBAL
	filters : ARRAY[0..7, 0..31] OF LCan_typeFilterList;	// [CAN-interface, proxyIndex]
END_VAR

// ======== POU LCan_SetTransparentFilter
FUNCTION_BLOCK LCan_SetTransparentFilter
// lcan_cl2 versie 0.3 (2026-11-27)
// Stijgende flank op execute: de regels van filterData met ignoreFilter = FALSE worden de
// filterlijst van (hwIoOfTransparentModul, proxyIndex) voor LCan_RcvTransparentMessage.
VAR_INPUT
	execute : BOOL;	// stijgende flank: lijst overnemen
	proxyIndex : BYTE;	// lijstnummer 0..31
	hwIoOfTransparentModul : USINT;	// CAN-interface 0..7
	cntOfFilter : USINT;	// aantal regels in filterData (1..16)
END_VAR
VAR_OUTPUT
	done : BOOL;
	busy : BOOL;
	error : BOOL;
	status : WORD;	// 16#0000 gezet, 16#8001 cntOfFilter niet 1..16, 16#8002 interface of lijstnummer te groot
END_VAR
VAR_IN_OUT
	filterData : ARRAY[*] OF LCan_typeTransparentFilter;
END_VAR
VAR
	edge : BOOL;
	i : DINT;
	lb : DINT;
	n : USINT;
	net : INT;
	px : INT;
END_VAR
// ---- code
net := USINT_TO_INT(hwIoOfTransparentModul);
px := BYTE_TO_INT(proxyIndex);
IF execute AND NOT edge THEN
	done := FALSE;
	error := FALSE;
	IF cntOfFilter = 0 OR cntOfFilter > 16 THEN
		error := TRUE;
		status := 16#8001;
	ELSIF net > 7 OR px > 31 THEN
		error := TRUE;
		status := 16#8002;
	ELSE
		lb := LOWER_BOUND(filterData, 1);
		n := 0;
		FOR i := 0 TO USINT_TO_DINT(cntOfFilter) - 1 DO
			IF lb + i <= UPPER_BOUND(filterData, 1) THEN
				IF NOT filterData[lb + i].ignoreFilter THEN
					LCan_CL2.filters[net, px].id[n] := filterData[lb + i].messageId AND 16#1FFFFFFF;
					n := n + 1;
				END_IF;
			END_IF;
		END_FOR;
		LCan_CL2.filters[net, px].count := n;
		LCan_CL2.filters[net, px].valid := TRUE;
		done := TRUE;
		status := 16#0000;
	END_IF;
ELSIF NOT execute THEN
	done := FALSE;
	error := FALSE;
END_IF;
edge := execute;
busy := FALSE;

// ======== POU LCan_RcvTransparentMessage
FUNCTION_BLOCK LCan_RcvTransparentMessage
// lcan_cl2 versie 0.3 (2026-11-27)
// Eén ontvangen 29-bit dataframe per handshake, zoals met de CM CAN: valid = TRUE toont een frame;
// een stijgende flank op ackMessage bevestigt het en toont het volgende frame dat door de filterlijst
// (LCan_SetTransparentFilter met hetzelfde netId en proxyIndex) komt. Elke instantie heeft een eigen
// CL2-ontvanger, dus elk blok krijgt alle frames, zoals elke receive proxy van de CM CAN.
VAR_INPUT
	enable : BOOL;
	netId : USINT;	// CAN-interface 0..7 (0 = de eerste)
	proxyIndex : BYTE;	// filterlijst 0..31
	deviceType : BOOL;	// niet gebruikt (CM CAN)
	ignoreRcvFilterSetting : BOOL;	// TRUE = alle 29-bit dataframes doorlaten
	resetRcvMsgBuffer : BOOL;	// stijgende flank: wachtende frames wissen
	ackMessage : BOOL;	// stijgende flank: getoond frame bevestigd
	baudrate : UINT := 250;	// kbit/s; ISOBUS gebruikt 250
END_VAR
VAR_OUTPUT
	valid : BOOL;	// messageId en messageData bevatten een frame
	busy : BOOL;
	error : BOOL;
	status : WORD;	// 16#7000 wacht op een frame, 16#0000 frame getoond, anders de CL2-foutcode (CL2.ERROR)
	messageId : DWORD;	// 29-bit identifier
END_VAR
VAR_IN_OUT
	messageData : ARRAY[0..7] OF BYTE;
END_VAR
VAR
	hDriver : CAA.HANDLE := CAA.gc_hINVALID;
	hReceiver : CAA.HANDLE := CAA.gc_hINVALID;
	hMsg : CAA.HANDLE;
	eErr : CL2.ERROR;
	pData : POINTER TO CL2I.DATA;
	ackOld : BOOL;
	resetOld : BOOL;
	id : DWORD;
	nBytes : USINT;
	pass : BOOL;
	i : INT;
	k : INT;
	net : INT;
	px : INT;
END_VAR
// ---- code
IF NOT enable THEN
	valid := FALSE;
	busy := FALSE;
	status := 16#7000;
	ackOld := ackMessage;
	resetOld := resetRcvMsgBuffer;
	RETURN;
END_IF;
busy := TRUE;
IF hDriver = CAA.gc_hINVALID THEN
	hDriver := CL2.DriverOpenH(usiNetId := netId, uiBaudrate := baudrate, xSupport29Bits := TRUE, ctMessages := 16, peError := ADR(eErr));
	IF hDriver = CAA.gc_hINVALID THEN
		error := TRUE;
		status := TO_WORD(eErr);
		RETURN;
	END_IF;
END_IF;
IF hReceiver = CAA.gc_hINVALID THEN
	// alle 29-bit dataframes, zonder de frames die we zelf versturen
	hReceiver := CL2.CreateMaskReceiver(hDriver := hDriver, cobIdValue := 0, cobIdMask := 0,
		xRTRValue := FALSE, xRTRMask := TRUE, x29BitIdValue := TRUE, x29BitIdMask := TRUE,
		xTransmitValue := FALSE, xTransmitMask := TRUE, xAlwaysNewest := FALSE,
		eEvent := CB.EVENT.NO_EVENT, xEnableSyncWindow := FALSE, peError := ADR(eErr));
	IF hReceiver = CAA.gc_hINVALID THEN
		error := TRUE;
		status := TO_WORD(eErr);
		RETURN;
	END_IF;
END_IF;
error := FALSE;
net := USINT_TO_INT(netId);
px := BYTE_TO_INT(proxyIndex);

IF resetRcvMsgBuffer AND NOT resetOld THEN	// wachtende frames wissen
	FOR i := 1 TO 1000 DO
		hMsg := CL2.Read(hReceiverId := hReceiver, pctMsgLeft := 0, peError := ADR(eErr));
		IF hMsg = CAA.gc_hINVALID THEN
			EXIT;
		END_IF;
		eErr := CL2.FreeMessage(hMessage := hMsg);
	END_FOR;
	valid := FALSE;
END_IF;
resetOld := resetRcvMsgBuffer;

IF ackMessage AND NOT ackOld THEN	// getoond frame bevestigd
	valid := FALSE;
END_IF;
ackOld := ackMessage;

IF NOT valid THEN	// het volgende frame dat door de filterlijst komt
	FOR i := 1 TO 64 DO
		hMsg := CL2.Read(hReceiverId := hReceiver, pctMsgLeft := 0, peError := ADR(eErr));
		IF hMsg = CAA.gc_hINVALID THEN
			EXIT;
		END_IF;
		id := TO_DWORD(CL2.GetMessageId(hMessage := hMsg, peError := ADR(eErr))) AND 16#1FFFFFFF;
		pass := ignoreRcvFilterSetting;
		IF NOT pass AND net <= 7 AND px <= 31 THEN
			IF LCan_CL2.filters[net, px].valid THEN
				FOR k := 0 TO USINT_TO_INT(LCan_CL2.filters[net, px].count) - 1 DO
					IF LCan_CL2.filters[net, px].id[k] = id THEN
						pass := TRUE;
					END_IF;
				END_FOR;
			END_IF;
		END_IF;
		IF pass THEN
			nBytes := CL2.GetMessageLength(hMessage := hMsg, peError := ADR(eErr));
			pData := CL2.GetMessageDataPointer(hMessage := hMsg, peError := ADR(eErr));
			FOR k := 0 TO 7 DO
				IF pData <> 0 AND k < USINT_TO_INT(nBytes) THEN
					messageData[k] := pData^[k];
				ELSE
					messageData[k] := 16#FF;
				END_IF;
			END_FOR;
			messageId := id;
			valid := TRUE;
		END_IF;
		eErr := CL2.FreeMessage(hMessage := hMsg);
		IF valid THEN
			EXIT;
		END_IF;
	END_FOR;
END_IF;
IF valid THEN
	status := 16#0000;
ELSE
	status := 16#7000;
END_IF;

// ======== POU LCan_SendTransparentMessage
FUNCTION_BLOCK LCan_SendTransparentMessage
// lcan_cl2 versie 0.3 (2026-11-27)
// Stijgende flank op execute: messageData (8 bytes) met messageId in de zendwachtrij van CL2.
// done of error volgt in dezelfde aanroep en blijft tot execute FALSE is.
VAR_INPUT
	execute : BOOL;	// stijgende flank: frame versturen
	netId : USINT;	// CAN-interface 0..7 (0 = de eerste)
	messageIdFormat : BOOL;	// TRUE = 29-bit identifier
	messageId : DWORD;
	rtrFrame : BOOL;
	deviceType : BOOL;	// niet gebruikt (CM CAN)
	baudrate : UINT := 250;	// kbit/s; ISOBUS gebruikt 250
	priority : USINT := 1;	// CL2: 1 = hoogste; frames met dezelfde prioriteit gaan in volgorde
END_VAR
VAR_OUTPUT
	done : BOOL;
	busy : BOOL;
	error : BOOL;
	status : WORD;	// 16#0000 verstuurd, anders de CL2-foutcode (CL2.ERROR)
END_VAR
VAR_IN_OUT
	messageData : ARRAY[0..7] OF BYTE;
END_VAR
VAR
	hDriver : CAA.HANDLE := CAA.gc_hINVALID;
	hMsg : CAA.HANDLE;
	eErr : CL2.ERROR;
	pData : POINTER TO CL2I.DATA;
	edge : BOOL;
	k : INT;
END_VAR
// ---- code
IF execute AND NOT edge THEN
	done := FALSE;
	error := FALSE;
	IF hDriver = CAA.gc_hINVALID THEN
		hDriver := CL2.DriverOpenH(usiNetId := netId, uiBaudrate := baudrate, xSupport29Bits := TRUE, ctMessages := 64, peError := ADR(eErr));
	END_IF;
	IF hDriver = CAA.gc_hINVALID THEN
		error := TRUE;
		status := TO_WORD(eErr);
	ELSE
		hMsg := CL2.CreateMessage(hDriver := hDriver, cobID := messageId, usiLength := 8, xRTR := rtrFrame,
			x29BitID := messageIdFormat, peError := ADR(eErr));
		IF hMsg = CAA.gc_hINVALID THEN
			error := TRUE;
			status := TO_WORD(eErr);
		ELSE
			pData := CL2.GetMessageDataPointer(hMessage := hMsg, peError := ADR(eErr));
			IF pData <> 0 THEN
				FOR k := 0 TO 7 DO
					pData^[k] := messageData[k];
				END_FOR;
			END_IF;
			eErr := CL2.Write(hDriver := hDriver, hMessage := hMsg, usiPriority := priority, xEnableSyncWindow := FALSE);
			IF eErr = CL2.ERROR.NO_ERROR THEN	// CL2 geeft het bericht zelf vrij na het versturen
				done := TRUE;
				status := 16#0000;
			ELSE	// bij een fout blijft het bericht van ons
				status := TO_WORD(eErr);
				error := TRUE;
				eErr := CL2.FreeMessage(hMessage := hMsg);
			END_IF;
		END_IF;
	END_IF;
ELSIF NOT execute THEN
	done := FALSE;
	error := FALSE;
END_IF;
edge := execute;
busy := FALSE;

// ======== POU Chars_TO_Strg
FUNCTION Chars_TO_Strg : BOOL
// lcan_cl2 versie 0.3 (2026-11-27)
// Zoals Chars_TO_Strg in TIA Portal: Cnt tekens vanaf Chars[pChars] (relatief tot de ondergrens) als tekst.
VAR_INPUT
	pChars : DINT;	// eerste teken, relatief tot de ondergrens van Chars
	Cnt : UINT;	// aantal tekens (max. 254)
END_VAR
VAR_OUTPUT
	Strg : STRING(254);
END_VAR
VAR_IN_OUT
	Chars : ARRAY[*] OF BYTE;
END_VAR
VAR
	i : DINT;
	n : DINT;
	lb : DINT;
	buf : STRING(254);
	pBuf : POINTER TO ARRAY[0..254] OF BYTE;	// de bytes van buf (geen index op de STRING zelf)
END_VAR
// ---- code
pBuf := ADR(buf);
lb := LOWER_BOUND(Chars, 1);
n := UINT_TO_DINT(Cnt);
IF n > 254 THEN
	n := 254;
END_IF;
IF lb + pChars + n - 1 > UPPER_BOUND(Chars, 1) THEN
	n := UPPER_BOUND(Chars, 1) - lb - pChars + 1;
END_IF;
IF n < 0 THEN
	n := 0;
END_IF;
FOR i := 0 TO n - 1 DO
	pBuf^[i] := Chars[lb + pChars + i];
END_FOR;
pBuf^[n] := 0;
Strg := buf;
Chars_TO_Strg := TRUE;

// ======== POU Strg_Byte
FUNCTION Strg_Byte : BYTE
// lcan_cl2 versie 0.3 (2026-11-27)
// Zoals CHAR_TO_BYTE(s[i]) in TIA Portal: teken i (vanaf 1) van een tekst, als byte. De vertaling schrijft
// CHAR_TO_BYTE(s[i]) als Strg_Byte(ADR(s), i). Een index op de STRING zelf (s[i - 1]) gaf in CODESYS telkens
// het eerste teken.
VAR_INPUT
	pStrg : POINTER TO ARRAY[0..254] OF BYTE;	// ADR(tekst), een STRING tot 254 tekens
	i : DINT;	// teken, vanaf 1
END_VAR
// ---- code
Strg_Byte := 0;
IF pStrg <> 0 AND i >= 1 AND i <= 255 THEN
	Strg_Byte := pStrg^[i - 1];
END_IF;
