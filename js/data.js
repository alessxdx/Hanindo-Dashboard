let BUYING=[
  {model:"Cutter Ejector Module KPM180H CN",pn:"976AH010000003",price:94.53,currency:"USD",group:"KPM180 Spare Parts"},
  {model:"PCBA CPU KPM180 E12 R2 ST101_DP007 VN UL",pn:"8120000000000961",price:70.08,currency:"USD",group:"KPM180 Spare Parts"},
  {model:"Autocutter KPM180H 85MM Kyoujin",pn:"9B2GR020000011",price:33.60,currency:"USD",group:"KPM180 Spare Parts"},
  {model:"TK180 TPH",pn:"43000000045700",price:23.88,currency:"USD"},
  {model:"KPM180 TPH",pn:"43000000045700",price:23.88,currency:"USD"},
  {model:"K80",pn:"915LC010137300",price:58.25,currency:"USD"},
  {model:"TG2480HIII",pn:"915CH030100300",price:112.00,currency:"USD"},
  {model:"VKP80III Rear Connector",pn:"915DX011700300",price:149.00,currency:"USD",specialPrice:135.60,specialCustomer:"Nanshan"},
  {model:"KX80S ETH USB RS232",pn:"915PF020100700",price:81.00,currency:"USD",specialPrice:81.00,specialCustomer:"Cui Zong"},
  {model:"TG2460HIII Standard Version",pn:"915CG040200300 or 915CG060100300",price:119.00,currency:"USD"},
  {model:"VKP80II-RX",pn:"915DW011200300",price:189.00,currency:"USD"},
  {model:"VKP80II Paper Roll Holder",pn:"974DW010000001",price:10.00,currency:"USD"},
  {model:"Roll Holder Kit for TK180 Metal",pn:"974HL010000009",price:46.35,currency:"USD"},
  {model:"New Metal Roll Holder for Bag Tag and GPP Paper (TK180 Plastic)",pn:"974HL020000004",price:46.80,currency:"USD"},
  {model:"TK180 Plastic AEA",pn:"911HL020900733",price:287.59,currency:"USD"},
  {model:"TK180 Metal Cutter NON AEA",pn:"911HL011200733",price:369,currency:"USD"},
  {model:"TK180 Metal Cutter AEA",pn:"911HL011300733",price:394,currency:"USD"},
  {model:"KPM180 NON AEA (China)",pn:"915AH020300700",price:260,currency:"USD"},
  {model:"KPM180 NON AEA (Outside China)",pn:"915AH020300700",price:275,currency:"USD"},
  {model:"KPM180H-LL",pn:"915AH030100700",price:360,currency:"USD"},
  {model:"TK202 Plastic",pn:"911BD050300313",price:445,currency:"USD"},
];
let OTHERS=[
  {date:"Sep\u2013Oct 2025",desc:"Service for Philippines",value:"$126,391.32 USD",sub:"360 printers \xb7 Breakdown: $51,378.60 (2 Sep 2025) + $75,012.72 (15 Oct 2025)"},
  {date:"18 Nov 2025",desc:"Service for Vietnam",value:"$15,364.92 USD",sub:""},
  {date:"",desc:"Arinc \u2014 Std TK180 TPH",value:"$108.80 USD EXW",sub:""},
  {date:"",desc:"Aboitiz Bohol \u2014 order summary",value:"$88,314.40 USD",sub:"EXW total $88,074.40 \u2192 Goodwill discount \u22123,000 \u2192 After discount $85,074.40 \u2192 DAP Bohol +$3,240 \u2192 Final $88,314.40"},
  {date:"",desc:"DAP \u2014 Delivered At Place",value:"Shipping term",sub:"Seller delivers to named destination. Buyer pays import duties & taxes. Aboitiz Bohol: transit via Manila/Cebu \u2014 Aboitiz InfraCapital clears customs and pays all duties & taxes."},
  {date:"",desc:"DDP \u2014 Delivered Duty Paid",value:"Shipping term",sub:"Seller bears all costs to destination including duties & customs clearance. Maximum obligation for seller."},
  {date:"",desc:"EXW \u2014 Ex Works",value:"Shipping term",sub:"Seller makes goods available at their premises. Buyer bears all transport costs, export & import clearance. Minimum obligation for seller."},
  {date:"",desc:"CIF \u2014 Cost, Insurance & Freight",value:"Shipping term",sub:"Seller pays freight & insurance to destination port. Risk transfers to buyer once goods are loaded on vessel."},
  {date:"",desc:"FOB \u2014 Free On Board",value:"Shipping term",sub:"Seller delivers on board vessel at origin port. Risk & cost transfer to buyer from that point."},
  {date:"",desc:"FOT — Free On Truck",value:"Shipping term",sub:"Inland logistics term. Seller is responsible for the goods, including the cost of loading them onto the buyer's designated truck, until they are safely loaded."},
  {date:"",desc:"CIP \u2014 Carriage & Insurance Paid To",value:"Shipping term",sub:"Seller pays freight & insurance to named destination. Risk transfers when goods handed to first carrier."},
  {date:"",desc:"CPT \u2014 Carriage Paid To",value:"Shipping term",sub:"Seller pays freight only (no insurance) to named destination. Risk transfers at first carrier handover."},
];
/* Deals live in the `projects` + `line_items` tables. This stays as an
   empty array because the legacy transaction path (dbToTx/editTx/
   resolveDeals) still reads it; nothing writes to it any more. */
let TX=[];

// Seed snapshots for first-run bootstrap of a genuinely empty database
var BUYING_SEED=BUYING.map(function(b){return Object.assign({},b);});
var OTHERS_SEED=OTHERS.map(function(o){return Object.assign({},o);});
var SPARES_SEED=[];
var MODELS_SEED=[];

// NEW (Stage 2): Projects + line items from new tables
let PROJECTS=[];
let LINE_ITEMS=[];
