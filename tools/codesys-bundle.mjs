// Builds the full CODESYS package (LCan_CL2.st, VT_Client, TC_Client, the tractor decoder and the exports of an example
// project) without a browser, for tools/check_st.py. Run from the repository root:
//   jsc -m tools/codesys-bundle.mjs -- st  [project.vtd.json]   → the ST text
//   jsc -m tools/codesys-bundle.mjs -- xml [project.vtd.json]   → the PLCopen XML
// (jsc = /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc). The task controller
// part is always included, also when the example has no implement switched on.
import { normalizeProject } from '../src/model.js';
import { codesysProjectObjects, codesysBlockObjects, plcopenXml, stText } from '../src/export/codesys.js';

const [what = 'st', file = 'voorbeelden/Diepgronder.vtd.json'] = typeof arguments !== 'undefined' ? arguments : [];
const B = 'isobus_project_bundle/';
try {
  const p = normalizeProject(JSON.parse(read(file)));
  p.implement.enabled = true;
  const objects = [
    ...codesysBlockObjects({
      lcan: read(B + 'codesys/LCan_CL2.st'),
      vtUdt: read(B + 'vt_client/01_VTC_Types.udt'),
      vtScl: read(B + 'vt_client/02_VT_Client.scl'),
      tcUdt: read(B + 'tc_client/01_TCC_Types.udt'),
      tcScl: read(B + 'tc_client/02_TC_Client.scl'),
      isoUdt: read(B + 'tia_isobus_decoder/01_ISO_Types.udt'),
      isoScl: read(B + 'tia_isobus_decoder/02_ISO_TractorDecode.scl'),
      isoCl2: read(B + 'codesys/ISO_TractorDecode_CL2.st'),
    }),
    ...codesysProjectObjects(p),
  ];
  print(what === 'xml' ? plcopenXml(objects, p.name) : stText(objects));
} catch (e) {
  print('FOUT: ' + e.message);
  if (typeof quit === 'function') quit(1);
}
