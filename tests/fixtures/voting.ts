// Fixtures for the voting module: verbatim rows from the BFS federal vote CSVs
// (assets 33707795 national, 33707737 per canton, 33707794 type/theme).
// Kept verbatim so a change in the upstream column layout shows up as a test failure.

// Four votes from 2024-11-24 plus the 1848 total revision (no popular counts).
export const NATIONAL_CSV = `"vorlage_id","vorlage_titel_de","vorlage_titel_fr","vorlage_titel_it","vorlage_titel_rm","vorlage_titel_en","urnengang_id","urnengang_datum","stimmberechtigte","stimmzettel_eingelegt","stimmbeteiligung","stimmzettel_leer","stimmzettel_ungueltig","stimmen_gueltig","stimmen_ja","stimmen_nein","ja_prozent","stimmen_ohne_antwort","staende_ja_ganz","staende_ja_halb","staende_nein_ganz","staende_nein_halb","staende_total_ganz","staende_total_halb","staende_ja","staende_total","staende_nein","staendemehr","vorlage_angenommen","provisorisch","daten_stand"
6760,"Änderung des Bundesgesetzes über die Krankenversicherung (KVG) (Einheitliche Finanzierung der Leistungen)","Modification de la loi fédérale sur l’assurance-maladie (LAMal) (financement uniforme des prestations)","Modifica della legge federale sull’assicurazione malattie (LAMal) (Finanziamento uniforme delle prestazioni)","Midada da la Lescha federala davart l'assicuranza da malsauns (LAMal) (finanziaziun unitara da las prestaziuns)","Amendment to the Health Insurance Act (standardised financing of benefits)",326,"2024-11-24",5615207,2520581,"44.888478732841",68798,8212,2443571,1302687,1140884,"53.310789823582",,14,6,6,0,20,6,"17",23,"6",,1,0,2026-06-14 18:17:40.904972
6750,"Änderung des Obligationenrechts (Mietrecht: Kündigung wegen Eigenbedarfs)","Modification du code des obligations (droit du bail: résiliation pour besoin propre)","Modifica del Codice delle obbligazioni (Diritto di locazione: disdetta per bisogno personale)","Midada dal Dretg d'obligaziuns (dretg da locaziun: disditga pervia d'in agen basegn)","Amendment to the Code of Obligations (tenancy law: termination to permit personal use)",326,"2024-11-24",5615207,2522010,"44.9139274829939",41516,7667,2472827,1141693,1331134,"46.1695460297061",,10,4,10,2,20,6,"12",23,"11",,0,0,2026-06-14 18:17:40.904972
6740,"Änderung des Obligationenrechts (Mietrecht: Untermiete)","Modification du code des obligations (droit du bail: sous-location)","Modifica del Codice delle obbligazioni (Diritto di locazione: sublocazione)","Midada dal Dretg d'obligaziuns (dretg da locaziun: sutlocaziun)","Amendment to the Code of Obligations (tenancy law: subletting)",326,"2024-11-24",5615207,2521429,"44.9035805803775",42203,7765,2471461,1196643,1274818,"48.418445607679",,11,5,9,1,20,6,"13.5",23,"9.5",,0,0,2026-06-14 18:17:40.904972
6730,"Bundesbeschluss über den Ausbauschritt 2023 für die Nationalstrassen","Arrêté fédéral sur l’étape d’aménagement 2023 des routes nationales","Decreto federale sulla Fase di potenziamento 2023 delle strade nazionali","Conclus federal davart il pass da cumplettaziun 2023 da las vias naziunalas","Federal Decree on the 2023 expansion programme for the national highways",326,"2024-11-24",5615207,2530270,"45.0610280262152",25141,7064,2498065,1181560,1316505,"47.2990094333014",,7,4,13,2,20,6,"9",23,"14",,0,0,2026-06-14 18:17:40.904972
10,"Totalrevision vom 12. September 1848","Revision totale du 12 septembre 1848","Revisione totale del 12 settembre 1848","","Total revision of 12th September 1848",1,"1848-06-06",,,,,,,,,,,14,3,5,3,19,6,"15.5",22,"6.5",1,1,0,2026-06-14 18:17:40.904972
3880,"Bundesbeschluss über den Europäischen Wirtschaftsraum (EWR)","Arrêté fédéral sur l'espace économique européen (EEE)","Decreto federale sullo Spazio economico europeo (SEE)","Conclus federal davart iI spazi economic europeic (SEE)","Federal decree on European Economic Area",227,"1992-12-06",4546571,3580094,"78.7427272113423",23487,7027,3549580,1762872,1786708,"49.6642419666552",,6,2,14,4,20,6,"7",23,"16",0,0,0,2026-06-14 18:17:40.904972`;

// Vorlage 6730 (Nationalstrassen), four cantons.
export const CANTON_CSV = `"vorlage_id","vorlage_titel_de","vorlage_titel_fr","vorlage_titel_it","vorlage_titel_rm","vorlage_titel_en","urnengang_id","urnengang_datum","kanton_nummer","kanton_bezeichnung","stimmberechtigte","stimmzettel_eingelegt","stimmbeteiligung","stimmzettel_leer","stimmzettel_ungueltig","stimmen_gueltig","stimmen_ja","stimmen_nein","ja_prozent","stimmen_ohne_antwort","standes_stimme","standes_staerke","provisorisch","daten_stand"
6730,"Bundesbeschluss über den Ausbauschritt 2023 für die Nationalstrassen","Arrêté fédéral sur l’étape d’aménagement 2023 des routes nationales","Decreto federale sulla Fase di potenziamento 2023 delle strade nazionali","Conclus federal davart il pass da cumplettaziun 2023 da las vias naziunalas","Federal Decree on the 2023 expansion programme for the national highways",326,"2024-11-24",22,"Vaud",478597,226961,47.4221526670664,3190,177,223594,92549,131045,41.3915400234353,,0,1,0,2026-06-14 18:17:43.684243
6730,"Bundesbeschluss über den Ausbauschritt 2023 für die Nationalstrassen","Arrêté fédéral sur l’étape d’aménagement 2023 des routes nationales","Decreto federale sulla Fase di potenziamento 2023 delle strade nazionali","Conclus federal davart il pass da cumplettaziun 2023 da las vias naziunalas","Federal Decree on the 2023 expansion programme for the national highways",326,"2024-11-24",25,"Genève",282079,132120,46.83794256219,3196,164,128760,55298,73462,42.9465672569121,,0,1,0,2026-06-14 18:17:43.684243
6730,"Bundesbeschluss über den Ausbauschritt 2023 für die Nationalstrassen","Arrêté fédéral sur l’étape d’aménagement 2023 des routes nationales","Decreto federale sulla Fase di potenziamento 2023 delle strade nazionali","Conclus federal davart il pass da cumplettaziun 2023 da las vias naziunalas","Federal Decree on the 2023 expansion programme for the national highways",326,"2024-11-24",4,"Uri",27175,13820,50.8555657773689,95,79,13646,6570,7076,48.1459768430309,,0,1,0,2026-06-14 18:17:43.684243
6730,"Bundesbeschluss über den Ausbauschritt 2023 für die Nationalstrassen","Arrêté fédéral sur l’étape d’aménagement 2023 des routes nationales","Decreto federale sulla Fase di potenziamento 2023 delle strade nazionali","Conclus federal davart il pass da cumplettaziun 2023 da las vias naziunalas","Federal Decree on the 2023 expansion programme for the national highways",326,"2024-11-24",1,"Zürich",972221,462309,47.5518426366022,3703,54,458552,222076,236476,48.4298400181441,,0,1,0,2026-06-14 18:17:43.684243
3880,"Bundesbeschluss über den Europäischen Wirtschaftsraum (EWR)","Arrêté fédéral sur l'espace économique européen (EEE)","Decreto federale sullo Spazio economico europeo (SEE)","Conclus federal davart iI spazi economic europeic (SEE)","Federal decree on European Economic Area",227,"1992-12-06",4,"Uri",25290,19816,78.3550810597074,91,54,19671,4943,14728,25.1283615474556,,0,1,0,2026-06-14 18:17:43.684243
3880,"Bundesbeschluss über den Europäischen Wirtschaftsraum (EWR)","Arrêté fédéral sur l'espace économique européen (EEE)","Decreto federale sullo Spazio economico europeo (SEE)","Conclus federal davart iI spazi economic europeic (SEE)","Federal decree on European Economic Area",227,"1992-12-06",22,"Vaud",359273,261087,72.6709215554745,1334,297,259456,203168,56288,78.3053774050321,,1,1,0,2026-06-14 18:17:43.684243`;

// Type and themes for vorlage 6730 and 6760.
export const META_CSV = `"vorlage_id","typ_bfs_id","typ_bfs_name_de","typ_bfs_name_fr","typ_bfs_name_it","typ_bfs_name_en","thema1_id","thema1_level","thema1_parent","thema1_name_de","thema1_name_fr","thema1_name_it","thema1_name_rm","thema1_name_en","thema2_id","thema2_level","thema2_parent","thema2_name_de","thema2_name_fr","thema2_name_it","thema2_name_rm","thema2_name_en","thema3_id","thema3_level","thema3_parent","thema3_name_de","thema3_name_fr","thema3_name_it","thema3_name_rm","thema3_name_en"
6760,2,"Fakultatives Referendum","Référendum facultatif","Referendum facoltativo","Optional referendum",1011,3,1010,"Gesundheitspolitik","Politique de la santé","Politica della salute","Politica da sanadad","Health policy",1024,3,1020,"Kranken- und Unfallversicherung","Assurance-maladie, assurance-accidents","Assicurazione malattia e infortuni","Assicuranza da malsauns e d'accidents","Health and accident insurance",630,2,600,"Öffentliche Ausgaben","Dépenses publiques","Spesa pubblica","Expensas publicas","Public expenditure"
6730,2,"Fakultatives Referendum","Référendum facultatif","Referendum facoltativo","Optional referendum",821,3,820,"Strassenbau","Construction des routes","Costruzioni stradali","Construcziun da vias","Road construction",930,2,900,"Umwelt","Environnement","Ambiente","Ambient","Environment",910,2,900,"Boden","Sol","Suolo","Terren","Soil"
3880,1,"Obligatorisches Referendum","Référendum obligatoire","Referendum obbligatorio","Mandatory referendum",223,3,220,"EWR","EEE","SEE","SEE","EEA",260,2,200,"Aussenwirtschaftspolitik","Politique économique extérieure","Politica economica esterna","Politica d'economia da l'exteriur","Foreign trade policy",410,2,400,"Wirtschaftspolitik","Politique économique","Politica economica","Politica economica","Economic policy"`;

/** Vorlage 6730: motorway expansion, rejected 47.3% yes, cantons 9 : 14. */
export const EXPECTED_NATIONALSTRASSEN = {
  id: 6730,
  date: "2024-11-24",
  yes_percent: 47.3,
  accepted: false,
  cantons_yes: 9,
  cantons_no: 14,
};

/** Vorlage 6740: sublet tenancy law, half-cantons make the canton counts fractional. */
export const EXPECTED_UNTERMIETE = {
  id: 6740,
  cantons_yes: 13.5,
  cantons_no: 9.5,
};

/** Vorlage 3880: EEA 1992 — rejected, and the cantonal majority failed 7 : 16. */
export const EXPECTED_EWR = {
  id: 3880,
  date: "1992-12-06",
  yes_percent: 49.66,
  turnout: 78.74,
  accepted: false,
  cantons_yes: 7,
  cantons_no: 16,
  cantonal_majority: false,
};

/** Vorlage 10: 1848 total revision — cantonal counts only, no popular vote counts. */
export const EXPECTED_1848 = {
  id: 10,
  date: "1848-06-06",
  accepted: true,
  cantons_yes: 15.5,
};
