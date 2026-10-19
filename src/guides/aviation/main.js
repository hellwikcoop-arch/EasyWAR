// Довідник ворожої авіації EasyWAR: ознаки розпізнавання, ТТХ, уразливі місця, рухомі частини й політ над ландшафтом.
// Код перенесено з опублікованого інтерактивного довідника; змінено лише завантаження: моделі читаються з локальних файлів `models/*.glb`,
// three береться з npm (без CDN), шрифти — локальні (../fonts).
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from '../room-env.js';
import {fetchBuffer, makeClock} from '../guide-kit.js';
import {creditHtml} from '../credits.js';
import {MODEL_URLS, LAND_URL} from './models.js';
import {RIG, FLY as FLYD} from './rig.js';
import {createReveal} from './reveal.js';
import {drawRoundel, MARK_SPOTS} from './reveal-core.js';

/* ---------- data ---------- */
// p: [fx tail→nose 0..1, fy bottom→top 0..1] snapped by a ray from the side; or [fx, 0, fz 0..1 across] snapped by a ray from above
const T=[
{id:'ka52',cat:'enemy',yaw:90,cls:'Ударний гелікоптер',name:'Ка-52 «Алігатор»',nato:'Hokum-B',
 st:'Основний ударний гелікоптер армійської авіації РФ, виробник — «Прогрес» (Арсеньєв). Модернізація Ка-52М несе ракети ЛМУР.',
 specs:[['Екіпаж','2 (поруч)'],['Довжина фюзеляжу','≈13,5 м'],['Несучі гвинти','2 × 14,5 м, співвісні'],['Висота','≈4,9 м'],['Макс. злітна маса','10 400 кг'],['Макс. швидкість','300 км/год'],['Крейсерська','260 км/год'],['Дальність','460 км (перегін 1 110)'],['Стеля','5 500 м (статична 3 600)'],['Двигуни','2 × ВК-2500, 2 200–2 400 к.с.']],
 arm:['30-мм гармата 2А42 на правому борту, 460 набоїв','До 12 ПТКР «Вихор»; на Ка-52М — ЛМУР «Виріб 305»','Блоки НАР С-8 / С-13','Ракети «Ігла-В» для самооборони'],
 rec:['Два співвісні гвинти, хвостового гвинта немає','Широка носова частина: пілоти сидять поруч','Куля оптико-електронної станції над кабіною і під носом','Крила з чотирма-шістьма вузлами підвіски, двокільове оперення'],
 weak:[
  {t:'Співвісна колонка і втулки гвинтів',d:'Ураження втулки, тяг перекосу або лопатей одного з гвинтів веде до втрати керування. При різкому маневрі лопаті верхнього і нижнього гвинтів можуть зійтися.',p:[.52,.97]},
  {t:'Двигуни і вихлоп',d:'Два ВК-2500 по боках фюзеляжу дають сильний тепловий слід. Екранно-вихлопні пристрої знижують ІЧ-помітність, але не прибирають її — головна загроза від ПЗРК.',p:[.5,.62]},
  {t:'Висіння під час пуску ПТКР',d:'«Вихор» наводиться лазерним променем до самого влучання, тож гелікоптер кілька секунд тримає ціль у полі зору і виходить з-за укриття.',p:[.86,.45]},
  {t:'Хвостове оперення',d:'Хвостового гвинта немає, але пошкодження кілів і стабілізатора погіршує курсову стійкість на швидкості.',p:[.08,.6]}],
 note:'Ка-52М з ЛМУР б\'є на ≈14 км, за межами досяжності ПЗРК. Тому важливіше рано виявити ймовірні точки висіння, ніж чекати на виліт гелікоптера на близьку відстань.',
 glass:/glass|alpha|rotorblur/i},

{id:'ka50',cat:'enemy',yaw:0,cls:'Ударний гелікоптер',name:'Ка-50 «Чорна акула»',nato:'Hokum-A',
 st:'Одномісний попередник Ка-52. Збудовано мало; з бойового складу знято, на зміну прийшов Ка-52. Трапляється рідко, здебільшого як навчальний або музейний.',
 specs:[['Екіпаж','1'],['Довжина фюзеляжу','≈13,5 м'],['Несучі гвинти','2 × 14,5 м, співвісні'],['Висота','≈4,9 м'],['Макс. злітна маса','10 800 кг'],['Макс. швидкість','≈310 км/год'],['Крейсерська','≈270 км/год'],['Дальність','≈460 км'],['Стеля','5 500 м'],['Двигуни','2 × ТВ3-117ВМА, 2 200 к.с.']],
 arm:['30-мм гармата 2А42','До 12 ПТКР «Вихор»','Блоки НАР С-8','Підвісні контейнери з гарматами'],
 rec:['Вузька одномісна кабіна (у Ка-52 — широка)','Співвісні гвинти, хвостового гвинта немає','Чорне забарвлення в багатьох машин'],
 weak:[
  {t:'Один пілот',d:'Пілот одночасно пілотує, шукає ціль і наводить зброю. На малій висоті саме перевантаження екіпажу було головною претензією до типу.',p:[.86,.5]},
  {t:'Співвісні гвинти',d:'Ті самі ризики, що й у Ка-52: ураження колонки або втулки критичне.',p:[.52,.96]},
  {t:'Тепловий слід двигунів',d:'Двигуни ТВ3-117 по боках фюзеляжу — ціль для ПЗРК.',p:[.5,.62]}],
 note:'Тип зустрічається рідко. В описах і на фото його часто плутають з Ка-52, тому розрізняйте за шириною кабіни.',
 glass:/mat_66/i,opaque:true},

{id:'ka27',cat:'enemy',yaw:-90,cls:'Корабельний протичовновий гелікоптер',name:'Ка-27',nato:'Helix-A',
 st:'Базується на кораблях і берегових аеродромах Чорноморського флоту РФ. Варіанти: Ка-27ПЛ (протичовновий), Ка-27ПС (пошуково-рятувальний), Ка-29 (транспортно-бойовий).',
 specs:[['Екіпаж','3'],['Довжина фюзеляжу','≈11,3 м'],['Несучі гвинти','2 × 15,9 м, співвісні'],['Висота','≈5,4 м'],['Нормальна злітна маса','≈11 000 кг'],['Макс. швидкість','270 км/год'],['Крейсерська','≈205 км/год'],['Дальність','≈980 км'],['Стеля','≈5 000 м'],['Двигуни','2 × ТВ3-117КМ, 2 225 к.с.']],
 arm:['Торпеди та глибинні бомби у внутрішньому відсіку','Радіогідроакустичні буї','Опускна гідроакустична станція'],
 rec:['Короткий «бочкоподібний» фюзеляж','Співвісні гвинти, двокільове оперення','Чотириколісне шасі, поплавкові балони на бортах'],
 weak:[
  {t:'Зависання з опускною ГАС',d:'Під час пошуку човна гелікоптер довго висить над водою на малій висоті майже нерухомо.',p:[.5,.18]},
  {t:'Двигуни над кабіною',d:'Обидва двигуни і редуктор зверху фюзеляжу, тепловий слід добре видно з верхньої півсфери.',p:[.6,.75]},
  {t:'Корабель або аеродром базування',d:'Між вильотами машина стоїть на палубі чи стоянці без укриття, і її легко уразити безпілотником.',p:[.3,.3]}],
 glass:/^$/},

{id:'mi26',cat:'enemy',yaw:180,cls:'Важкий транспортний гелікоптер',name:'Мі-26',nato:'Halo',
 st:'Найбільший серійний гелікоптер у світі. Возить техніку, пальне і вантажі до 20 т, евакуює пошкоджену техніку. Двигуни Д-136 розроблені й вироблялися в Запоріжжі.',
 specs:[['Екіпаж','5'],['Довжина','33,7 м (з гвинтами ≈40 м)'],['Несучий гвинт','32 м, 8 лопатей'],['Висота','≈8,1 м'],['Макс. злітна маса','56 000 кг'],['Вантаж','до 20 000 кг'],['Макс. швидкість','295 км/год'],['Крейсерська','255 км/год'],['Дальність','≈800 км'],['Двигуни','2 × Д-136, по 11 400 к.с.']],
 arm:['Без озброєння'],
 rec:['Гігантські розміри, восьмилопатевий несучий гвинт','Задня вантажна рампа зі стулками','Кабіна з великим склінням, двигуни над нею'],
 weak:[
  {t:'Розміри і помітність',d:'Величезні тепловий, радіолокаційний і візуальний сліди. Видно здалеку, особливо під час розвантаження на майданчику.',p:[.5,.5]},
  {t:'Головний редуктор ВР-26',d:'Один редуктор передає понад 20 000 к.с. Його пошкодження означає вимушену посадку.',p:[.55,.9]},
  {t:'Двигуни Д-136',d:'Запчастини і ремонт зав\'язані на українське виробництво, тож кожна втрачена машина для РФ малозамінна.',p:[.66,.8]},
  {t:'Хвостова балка і рульовий гвинт',d:'Довга незахищена балка з п\'ятилопатевим рульовим гвинтом.',p:[.1,.7]}],
 glass:/^$/},

{id:'mi35',cat:'enemy',yaw:-90,cls:'Транспортно-бойовий гелікоптер',name:'Мі-35М',nato:'Hind-E',
 st:'Модернізований Мі-24 з двигунами ВК-2500, композитними гвинтами від Мі-28 і нерухомим шасі. В армії РФ разом із Мі-24П/В та Мі-24ПН.',
 specs:[['Екіпаж','2 (+ до 8 десантників)'],['Довжина фюзеляжу','≈18,6 м'],['Несучий гвинт','≈17,2 м'],['Висота','≈4 м'],['Макс. злітна маса','11 800 кг'],['Макс. швидкість','300 км/год'],['Крейсерська','260 км/год'],['Дальність','≈450 км (перегін ≈1 000)'],['Стеля','≈5 750 м'],['Двигуни','2 × ВК-2500']],
 arm:['Двоствольна 23-мм ГШ-23В у рухомій турелі','ПТКР «Атака» / «Штурм»','Блоки НАР С-8, С-13','Ракети «Ігла» на крилах'],
 rec:['Тандемна кабіна з двома «бульбашками»','Нерухоме (неприбирне) шасі — головна відмінність від Мі-24','Вкорочені крила з підвісками, X-подібний рульовий гвинт'],
 weak:[
  {t:'Хвостова балка і рульовий гвинт',d:'Класична слабка зона родини Мі-24: кабіну і двигуни частково броньовано, а хвіст — ні.',p:[.1,.6]},
  {t:'Двигуни і вихлоп',d:'Вихлопні пристрої знижують ІЧ-слід, але гелікоптер лишається ціллю для ПЗРК, особливо на виході з атаки.',p:[.55,.72]},
  {t:'Маневреність і висіння',d:'Важкий гелікоптер погано висить у спеку і на висоті, тому атакує з ходу або з кабрування: траєкторію можна передбачити.',p:[.8,.45]},
  {t:'Десантна кабіна',d:'Середня частина фюзеляжу має мінімальне бронювання.',p:[.6,.42]}],
 note:'Мі-24 є і в ЗСУ. Мі-35М відрізняється нерухомим шасі та X-подібним рульовим гвинтом.',
 dual:'Мі-24 інших модифікацій використовують обидві сторони — не визначайте приналежність лише за силуетом.',
 glass:/glass/i},

{id:'mi8tv',cat:'enemy',yaw:90,cls:'Транспортно-бойовий гелікоптер',name:'Мі-8ТВ (родина Мі-8)',nato:'Hip-E',
 st:'Найпоширеніший гелікоптер РФ: транспорт, десант, евакуація, РЕБ, ударні завдання. Модель показує озброєний Мі-8ТВ; у строю РФ переважно Мі-8МТВ-5 і Мі-8АМТШ.',
 specs:[['Екіпаж','3 (+ до 24 десантників)'],['Довжина фюзеляжу','18,2 м (з гвинтами 25,2)'],['Несучий гвинт','21,3 м'],['Висота','≈5,7 м'],['Макс. злітна маса','12 000 кг'],['Макс. швидкість','250 км/год'],['Крейсерська','225 км/год'],['Дальність','≈450 км'],['Стеля','4 500 м'],['Двигуни','2 × ТВ2-117 (на МТ — ТВ3-117)']],
 arm:['12,7-мм кулемет у носі (Мі-8ТВ)','Блоки НАР УБ-32 / Б-8 на шести вузлах','ПТКР «Фаланга», бомби до 500 кг','Кулемети у дверях і вікнах'],
 rec:['Довгий «огірок» фюзеляжу з круглими вікнами','П\'ятилопатевий несучий гвинт','Ферми з вузлами підвіски по бортах','Задні стулки-двері вантажної кабіни'],
 weak:[
  {t:'Зовнішні паливні баки',d:'Великі баки на бортах фюзеляжу без бронювання — ризик пожежі при влученні.',p:[.6,.38]},
  {t:'Хвостова балка і рульовий гвинт',d:'Довга незахищена балка. Ураження рульового гвинта змушує до аварійної посадки.',p:[.06,.62]},
  {t:'Посадковий майданчик',d:'На висінні та під час висадки десанту гелікоптер кілька хвилин майже нерухомий.',p:[.44,.14]},
  {t:'Двигуни над кабіною',d:'Двигуни ТВ2/ТВ3-117 зверху, ІЧ-слід видно з верхньої півсфери.',p:[.68,.82]}],
 dual:'Мі-8/Мі-17 масово використовують і ЗСУ — розрізняйте за розпізнавальними знаками та обставинами.',
 glass:/glass|alpha/i},

{id:'mi2',cat:'enemy',yaw:-90,cls:'Легкий багатоцільовий гелікоптер',name:'Мі-2',nato:'Hoplite',
 st:'Легкий гелікоптер виробництва PZL-Świdnik (Польща). У РФ лишився переважно в навчальних частинах і ДОСААФ; на фронті трапляється рідко.',
 specs:[['Екіпаж','1–2 (+ до 8 пасажирів)'],['Довжина фюзеляжу','11,4 м (з гвинтами 17,4)'],['Несучий гвинт','14,5 м'],['Висота','≈3,75 м'],['Макс. злітна маса','3 700 кг'],['Макс. швидкість','210 км/год'],['Крейсерська','≈195 км/год'],['Дальність','≈440 км'],['Стеля','4 000 м'],['Двигуни','2 × ГТД-350, по 400 к.с.']],
 arm:['Зазвичай без озброєння','Окремі варіанти — кулемети, НАР, ПТКР «Малютка»'],
 rec:['Малі розміри, трилопатевий несучий гвинт','Двигуни над кабіною, повітрозабірник спереду','Чотириколісне шасі з полозами під хвостом'],
 weak:[
  {t:'Повна відсутність броні',d:'Легкий фюзеляж уражають навіть стрілецька зброя і уламки.',p:[.75,.45]},
  {t:'Низька швидкість',d:'≈200 км/год — довго перебуває в зоні ураження.',p:[.4,.5]},
  {t:'Хвостова балка',d:'Тонка балка з рульовим гвинтом.',p:[.1,.6]}],
 dual:'Мі-2 є і в ЗСУ та прикордонній службі — тип сам по собі не вказує на приналежність.',
 glass:/^$/},

{id:'an26',cat:'enemy',yaw:90,cls:'Військово-транспортний літак',name:'Ан-26',nato:'Curl',
 st:'Легкий транспортник КБ Антонова (Київ). У РФ — перевезення особового складу, вантажів, радіорозвідка (Ан-26РТ). Парк старіє: запчастини й ремонт пов\'язані з Україною.',
 specs:[['Екіпаж','5'],['Довжина','23,8 м'],['Розмах крила','29,2 м'],['Висота','8,6 м'],['Макс. злітна маса','24 000 кг'],['Вантаж','до 5 500 кг'],['Макс. швидкість','540 км/год'],['Крейсерська','≈435 км/год'],['Дальність','≈1 100 км з макс. вантажем'],['Двигуни','2 × АІ-24ВТ + допоміжний РУ-19А-300']],
 arm:['Без озброєння'],
 rec:['Високоплан, консолі крила з від\'ємним V','Задня вантажна рампа під хвостом','Блістер штурмана на лівому борту','Допоміжний реактивний двигун у правій мотогондолі'],
 weak:[
  {t:'Паливо в крилах',d:'Паливні баки-кесони в крилі не протектовані.',p:[.47,0,.72]},
  {t:'Злітна смуга',d:'Потрібен аеродром. На стоянці літак вразливий до ударів дронами та ракетами.',p:[.4,.08]},
  {t:'Повільний захід на посадку',d:'На глісаді літак повільний і передбачуваний.',p:[.85,.4]}],
 dual:'Ан-26 використовують і ЗСУ — визначайте приналежність лише за додатковими ознаками.',
 glass:/29fe82ee|glass/i},

{id:'mi8ua',model:'mi8tv',mark:'ua',reveal:true,cat:'other',yaw:90,cls:'Транспортно-бойовий гелікоптер · Україна',name:'Мі-8 (ЗСУ)',nato:'Hip',
 st:'Основний гелікоптер армійської авіації ЗСУ: Мі-8МТ, Мі-8МТВ, Мі-17 і модернізовані Мі-8МСБ-В. Перевезення, десант, евакуація, пошук і рятування, удари НАР і полювання на дрони. Та сама модель, що й у довіднику противника, з українськими розпізнавальними знаками; кнопка «Презентація» показує її в ангарі під чохлом із запуском і зльотом.',
 specs:[['Екіпаж','3'],['Довжина фюзеляжу','18,4 м (з гвинтами 25,3)'],['Несучий гвинт','21,3 м'],['Висота','≈5,65 м'],['Макс. злітна маса','13 000 кг'],['Вантаж','до 4 000 кг (на зовнішній підвісці до 4 000)'],['Макс. швидкість','250 км/год'],['Крейсерська','220–230 км/год'],['Дальність','≈600 км (перегін ≈1 100 з додатковими баками)'],['Стеля','6 000 м (статична ≈3 980)'],['Двигуни','2 × ТВ3-117МТ/ВМ по 2 000–2 200 к.с.; на Мі-8МСБ-В — ТВ3-117ВМА-СБМ1В (Мотор Січ)']],
 arm:['Блоки НАР Б-8В20А (С-8) на бортових фермах','Кулемети ПКТ / ДШК у дверях і вікнах','Бомби до 500 кг — залежно від завдання','Засоби захисту: теплові пастки, станції РЕБ (за комплектацією)'],
 rec:['Довгий «огірок» фюзеляжу з круглими вікнами, п\'ятилопатевий несучий гвинт','Українські розпізнавальні знаки: коло з тризубом на фюзеляжі','Транспортні МТ/МТВ без носового кулемета (на моделі показано озброєний Мі-8ТВ)','Задні стулки-двері вантажної кабіни'],
 weakTitle:'Чутливі вузли',
 weak:[
  {t:'Головний редуктор і втулка гвинта',d:'Один редуктор передає потужність обох двигунів. Його пошкодження означає вимушену посадку, тож стоянки й маршрути підльоту бережуть від ПЗРК і дронів.',p:[.55,.95]},
  {t:'Двигуни й вихлоп',d:'Двигуни над кабіною дають тепловий слід, видимий з верхньої півсфери; екранно-вихлопні пристрої його зменшують, але не прибирають.',p:[.68,.82]},
  {t:'Зовнішні паливні баки',d:'Великі баки по бортах без бронювання: при влученні ризик пожежі. Дозаправлення й стоянка — поза зоною спостереження противника.',p:[.6,.38]},
  {t:'Хвостова балка і рульовий гвинт',d:'Довга незахищена балка; ураження рульового гвинта змушує до аварійної посадки.',p:[.06,.62]}],
 note:'Модель — Мі-8ТВ: носовий кулемет і ферми озброєння є не на всіх українських машинах. Розпізнавальні знаки на моделі замінено програмно (коло з тризубом поверх текстури), сам файл моделі не змінювався.',
 glass:/glass|alpha/i},

{id:'an225',cat:'other',yaw:-90,cls:'Надважкий транспортний літак · Україна',name:'Ан-225 «Мрія»',nato:'Cossack',
 st:'Єдиний збудований екземпляр знищено в ангарі аеропорту Гостомель під час боїв наприкінці лютого 2022 року. Найважчий літак, що будь-коли літав.',
 specs:[['Екіпаж','6'],['Довжина','84,0 м'],['Розмах крила','88,4 м'],['Висота','18,1 м'],['Макс. злітна маса','640 000 кг'],['Вантаж','до 250 000 кг'],['Крейсерська','≈800 км/год'],['Дальність','≈4 000 км з 200 т'],['Двигуни','6 × Д-18Т «Мотор Січ»']],
 arm:['Без озброєння'],
 rec:['Шість двигунів, двокільове оперення','Носова вантажна рампа, що відкидається вгору'],
 weak:[],
 glass:/^$/,
 opaque:true},

{id:'fp5',cat:'other',yaw:0,cls:'Крилата ракета · Україна',name:'FP-5 «Фламінго»',nato:'—',
 st:'Крилата ракета наземного базування компанії Fire Point. Перше заявлене бойове застосування — 30 серпня 2025 року. Цифри — заявлені виробником.',
 specs:[['Довжина','12–14 м'],['Розмах крила','≈6 м'],['Стартова маса','≈6 000 кг'],['Бойова частина','1 150 кг'],['Дальність','до 3 000 км'],['Швидкість','до 950 км/год'],['Двигун','турбовентиляторний АІ-25ТЛ + стартовий прискорювач'],['Наведення','супутникове + інерціальне, заявлене КВО 14 м']],
 arm:['Фугасна бойова частина 1 150 кг'],
 rec:['Двигун на пілоні зверху фюзеляжу','Прямі крила посередині корпусу'],
 weak:[],
 glass:/^$/},

{id:'fp7',cat:'other',yaw:-90,cls:'Балістична ракета · Україна',name:'FP-7',nato:'—',
 st:'Балістична ракета Fire Point. Виробник повідомив про завершення випробувань. Наступний ступінь лінійки — FP-9 з дальністю 800 км. Цифри — заявлені виробником.',
 specs:[['Дальність','до 200 км'],['Бойова частина','150 кг'],['Макс. швидкість','1 500 м/с'],['Точність','заявлене КВО 14 м']],
 arm:['Бойова частина 150 кг'],
 rec:['Тонкий циліндричний корпус, конічний обтічник, хрестоподібні стабілізатори'],
 weak:[],
 glass:/^$/},

{id:'tu22',cat:'enemy',yaw:90,cls:'Далекий ракетоносець-бомбардувальник',name:'Ту-22М3',nato:'Backfire-C',
 st:'Надзвуковий ракетоносець зі змінною стріловидністю крила, будується в Казані. Разом з Ту-95МС і Ту-160 становить основу дальньої авіації РФ. Основне озброєння — важкі ракети Х-22 і Х-32, які пускають за сотні кілометрів від цілі.',
 specs:[['Екіпаж','4'],['Довжина','≈42,5 м'],['Розмах крила','34,3 м (20°) / 23,3 м (65°)'],['Висота','≈11 м'],['Макс. злітна маса','≈124 000 кг'],['Макс. швидкість','≈2 300 км/год (М≈2) на висоті'],['Крейсерська','≈900 км/год'],['Бойовий радіус','≈2 400 км без дозаправки'],['Практична стеля','≈13 300 м'],['Двигуни','2 × НК-25, по ≈245 кН на форсажі']],
 arm:['Надзвукові ракети Х-22 / Х-32: одна під фюзеляжем і дві під крилом','Ракети Х-15 на ротаційній установці у відсіку','Вільнопадаючі бомби до ≈24 000 кг (ФАБ-250/500, мінні поля)'],
 rec:['Змінна стріловидність: на зльоті й посадці крила розкладені, на швидкості — складені назад','Два двигуни у хвостовій частині фюзеляжу, клиноподібні повітрозабірники по боках від кабіни','Довгий загострений ніс, один великий кіль і суцільноповоротний стабілізатор','Основне шасі — по одному шестиколісному візку (три осі) з кожного боку, під коренями крил'],
 weak:[
  {t:'Стоянки й аеродроми базування',d:'Літаки базуються на кількох великих аеродромах і між вильотами стоять просто неба на площадках. Саме на землі вони найбільш вразливі до ударів дронів і ракет.',p:[.385,.07]},
  {t:'Двигуни і хвостова частина',d:'Два НК-25 у хвості дають потужний тепловий слід на форсажі. З задньої півсфери літак добре виявляє ІЧ-головками перехоплювачів і ракет повітря—повітря.',p:[.17,.34]},
  {t:'Вузол змінної стріловидності',d:'Поворотні консолі крила — складна механіка. Пошкодження вузла й заклинювання консолі роблять посадку на малій швидкості дуже складною.',p:[.46,0,.66]},
  {t:'Пуск з великої відстані',d:'Х-22 і Х-32 пускаються за сотні кілометрів, тож сам літак у зону ППО не заходить. Ефективна протидія — раннє виявлення вильоту, перехоплення ракет і удари по аеродромах.',p:[.5,.32]}],
 note:'Модель — Ту-22М3 з DCS World. Нова версія Ту-22М3М має оновлений радіоелектронний комплекс і двигуни, але зовні майже не відрізняється.',
 glass:/^$/},

{id:'tu95',cat:'enemy',yaw:90,cls:'Стратегічний ракетоносець',name:'Ту-95МС',nato:'Bear-H',
 st:'Турбогвинтовий стратегічний ракетоносець, що літає з 1950-х років. Носій крилатих ракет Х-101 і Х-555 у дальній авіації РФ. Модель показує ранній варіант Ту-95М; у строю нині Ту-95МС, який відрізняється штангою дозаправки на носі.',
 specs:[['Екіпаж','7'],['Довжина','≈49 м'],['Розмах крила','≈51 м'],['Висота','≈12 м'],['Макс. злітна маса','≈185 000 кг'],['Макс. швидкість','≈830 км/год'],['Крейсерська','≈710 км/год'],['Дальність','до ≈10 000 км і більше з дозаправкою'],['Практична стеля','≈11 000 м'],['Двигуни','4 × НК-12МП, по ≈11 000 кВт, співвісні гвинти АВ-60']],
 arm:['Крилаті ракети Х-101 / Х-555 / Х-55: 6 у відсіку на барабанній установці, до 16 з зовнішніми підвісками (Ту-95МС16)','Кормова установка ГШ-23 (на частині літаків знята)'],
 rec:['Чотири турбогвинтові двигуни; на кожному співвісні гвинти з 4+4 лопатей — характерний гул','Крило з великою стріловидністю і довгі гондоли двигунів, головне шасі ховається в гондоли внутрішніх двигунів','Дуже довгий круглий фюзеляж, велике одне кільове оперення','Штанга дозаправки зверху на носі (на Ту-95МС; на моделі її немає)'],
 weak:[
  {t:'Гучність і тепловий слід',d:'Чотири турбогвинтові двигуни з співвісними гвинтами — найгучніший літак у світі. Видно здалеку і на радіолокаторі (великий ЕПР), і за теплом двигунів.',p:[.64,0,.62]},
  {t:'Низька швидкість',d:'Крейсерська ≈700 км/год — вдвічі повільніше за Ту-22М3. Після виявлення в повітрі легко перехоплюється винищувачами, тому літаки пускають ракети з великої відстані.',p:[.52,0,.775]},
  {t:'Стоянки й аеродроми',d:'Базується на невеликому числі великих аеродромів і стоїть на відкритих площадках. Саме на землі вразливий найбільше.',p:[.62,.08]},
  {t:'Пуск з великої відстані',d:'Х-101 і Х-555 пускаються за 1 500–2 500 км від цілі. Літак у зону ППО не заходить, тож важливо виявити виліт, збити ракети в повітрі і вразити аеродроми базування.',p:[.5,.3]}],
 note:'Назви Ту-95М і Ту-95МС часто плутають. Ту-95М — ранній варіант 1950-х, Ту-95МС — модернізація 1980-х, яка нині в строю РФ.',
 glass:/^$/},
];

/* ---------- rig / flight data (rig.js, imported above) ---------- */

/* ---------- three setup ---------- */
const $=s=>document.querySelector(s);
const stage=$('#stage'),cv=$('#cv');
const PI=Math.PI,D2R=PI/180,G=9.81;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const R=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,preserveDrawingBuffer:!!window.__keep});R.setClearColor(0x000000,0);
R.setPixelRatio(Math.min(devicePixelRatio,2));
R.toneMapping=THREE.ACESFilmicToneMapping;R.toneMappingExposure=1.05;
R.outputColorSpace=THREE.SRGBColorSpace;
const SKY=0xa7b6c1;
const scene=new THREE.Scene();
scene.environment=new THREE.PMREMGenerator(R).fromScene(new RoomEnvironment(),0.04).texture;
const key=new THREE.DirectionalLight(0xfff4e0,1.4);key.position.set(6,10,7);scene.add(key);
const hemi=new THREE.HemisphereLight(0xd8e0d0,0x1a1c18,.6);scene.add(hemi);
const cam=new THREE.PerspectiveCamera(32,1,.05,500);
const ctl=new OrbitControls(cam,cv);ctl.enableDamping=true;ctl.dampingFactor=.08;ctl.autoRotate=true;ctl.autoRotateSpeed=.7;ctl.minDistance=3;ctl.maxDistance=40;ctl.enablePan=false;
// floor ring
const floor=new THREE.Group();scene.add(floor);
{const g=new THREE.RingGeometry(4.6,4.63,128);const m=new THREE.MeshBasicMaterial({color:0x3d4439,side:THREE.DoubleSide});const r=new THREE.Mesh(g,m);r.rotation.x=-Math.PI/2;floor.add(r);
 const grid=new THREE.PolarGridHelper(4.6,12,4,64,0x262b24,0x262b24);floor.add(grid);}
const holder=new THREE.Group();scene.add(holder);

const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
const cache={};let cur=null,curId=null,meshes=[],markers=[],selW=-1,frameN=0;
const SIZE=8; // longest dimension in scene units (plate)

const fetchModel=t=>fetchBuffer(MODEL_URLS[t.model||t.id]); // t.model: стаття показує файл іншої статті

/* ---------- baking and splitting meshes into parts (triangle runs) ---------- */
const V3=(a,b,c)=>Array.isArray(a)?new THREE.Vector3(a[0],a[1],a[2]):new THREE.Vector3(a,b,c);
const ZERO=new THREE.Vector3(),ZAX=new THREE.Vector3(0,0,1);
function bakeMesh(o,m){
  const g=o.geometry,pa=g.attributes.position,na=g.attributes.normal,ua=g.attributes.uv,n=pa.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),uv=new Float32Array(n*2),v=new THREE.Vector3(),nm=new THREE.Matrix3().getNormalMatrix(m);
  const sk=o.isSkinnedMesh&&o.skeleton&&g.attributes.skinIndex&&g.attributes.skinWeight; // skinned: bake the pose three.js renders
  let bm=null;if(sk){o.updateWorldMatrix(true,false);o.skeleton.bones.forEach(b=>b.updateWorldMatrix(true,false));bm=o.skeleton.bones.map((b,i)=>new THREE.Matrix4().multiplyMatrices(b.matrixWorld,o.skeleton.boneInverses[i]));}
  const p0=new THREE.Vector3(),acc=new THREE.Vector3(),nacc=new THREE.Vector3(),tmp=new THREE.Vector3(),n0=new THREE.Vector3(),nv=new THREE.Vector3();
  for(let i=0;i<n;i++){
    v.fromBufferAttribute(pa,i);if(na)nv.fromBufferAttribute(na,i);
    if(sk){
      const si=g.attributes.skinIndex,sw=g.attributes.skinWeight;
      p0.copy(v).applyMatrix4(o.bindMatrix);if(na)n0.copy(nv).transformDirection(o.bindMatrix);
      acc.set(0,0,0);nacc.set(0,0,0);
      for(let c=0;c<4;c++){const w=c===0?sw.getX(i):c===1?sw.getY(i):c===2?sw.getZ(i):sw.getW(i);if(!w)continue;
        const bi=c===0?si.getX(i):c===1?si.getY(i):c===2?si.getZ(i):si.getW(i),B=bm[bi];
        acc.addScaledVector(tmp.copy(p0).applyMatrix4(B),w);if(na)nacc.addScaledVector(tmp.copy(n0).transformDirection(B),w);}
      v.copy(acc).applyMatrix4(o.bindMatrixInverse);if(na)nv.copy(nacc).transformDirection(o.bindMatrixInverse);
    }
    v.applyMatrix4(m);pos[i*3]=v.x;pos[i*3+1]=v.y;pos[i*3+2]=v.z;
    if(na){nv.applyMatrix3(nm).normalize();nor[i*3]=nv.x;nor[i*3+1]=nv.y;nor[i*3+2]=nv.z;}
    if(ua){uv[i*2]=ua.getX(i);uv[i*2+1]=ua.getY(i);}}
  let ix;if(g.index){ix=new Uint32Array(g.index.array);}else{ix=new Uint32Array(n);for(let i=0;i<n;i++)ix[i]=i;}
  if(m.determinant()<0){for(let t=0;t<ix.length;t+=3){const q=ix[t+1];ix[t+1]=ix[t+2];ix[t+2]=q;}} // mirrored node: keep the front faces front
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));if(na)geo.setAttribute('normal',new THREE.BufferAttribute(nor,3));if(ua)geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  return {pos,ix,geo,mat:Array.isArray(o.material)?o.material[0]:o.material,claimed:new Uint8Array(ix.length/3),name:o.name||''};
}
function subMesh(src,tris,mat){
  const out=new Uint32Array(tris.length*3);for(let i=0;i<tris.length;i++){const t=tris[i];out[i*3]=src.ix[t*3];out[i*3+1]=src.ix[t*3+1];out[i*3+2]=src.ix[t*3+2];}
  const g=new THREE.BufferGeometry();for(const k in src.geo.attributes)g.setAttribute(k,src.geo.attributes[k]);g.setIndex(new THREE.BufferAttribute(out,1));
  return new THREE.Mesh(g,mat||src.mat);
}
function rleTris(rl){const out=[];for(const [s,n] of rl)for(let t=s;t<s+n;t++)out.push(t);return out;}
function partMeshes(srcs,spec,names,matFn){const out=[];[].concat(names).forEach(nm=>{for(const mi in spec){const rl=spec[mi][nm];if(!rl)continue;const s=srcs[+mi];if(!s)continue;const tris=rleTris(rl);tris.forEach(t=>s.claimed[t]=1);out.push(subMesh(s,tris,matFn?matFn(s.mat):null));}});return out;}
function restMeshes(srcs){const out=[];srcs.forEach(s=>{const tris=[];for(let t=0;t<s.claimed.length;t++)if(!s.claimed[t])tris.push(t);if(tris.length)out.push(subMesh(s,tris));});return out;}
function mkFrame(parent,p){const g=new THREE.Group();g.position.copy(p);const inner=new THREE.Group();inner.position.copy(p).multiplyScalar(-1);g.add(inner);parent.add(g);return {g,inner,p:p.clone()};}
const discMat=(col,op)=>new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op,depthWrite:false,side:THREE.DoubleSide,fog:false});

/* connected components (welded by position) for the scan tool */
function compsOf(src,q){
  const n=src.pos.length/3,km=new Map(),vid=new Int32Array(n);let nv=0;
  for(let i=0;i<n;i++){const k=Math.round(src.pos[i*3]*q)+'_'+Math.round(src.pos[i*3+1]*q)+'_'+Math.round(src.pos[i*3+2]*q);let id=km.get(k);if(id===undefined){id=nv++;km.set(k,id);}vid[i]=id;}
  const par=new Int32Array(nv);for(let i=0;i<nv;i++)par[i]=i;
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  const nt=src.ix.length/3;
  for(let t=0;t<nt;t++){const a=find(vid[src.ix[t*3]]),b=find(vid[src.ix[t*3+1]]),c=find(vid[src.ix[t*3+2]]);if(a!==b)par[b]=a;const a2=find(a);if(a2!==c)par[c]=a2;}
  const cid=new Int32Array(nt),rm=new Map();let nc=0;
  for(let t=0;t<nt;t++){const r=find(vid[src.ix[t*3]]);let c=rm.get(r);if(c===undefined){c=nc++;rm.set(r,c);}cid[t]=c;}
  return {cid,nc};
}

/* ---------- shared state ---------- */
let cat='enemy',view='iso',anim=null,marksOn=true,wasSpin=true;
const AN={k:0,on:true,gear:0,gearUp:false,sw:0,swT:0};
const FL={on:false,busy:false,cam:'follow',t:0,x:0,y:0,z:0,cx:0,cz:0,psi:0,ph:0,th:0,v:0,R:300,alt:100,D:50,sc:1,pitch:0,bank:0};
const LAND={ready:false,loading:null,failed:false,g:new THREE.Group(),S:1.2,YS:.5,GW:140,GH:104,H:null,y0:0,L:0,W:0,bb:null,tiles:[],ci:1e9,cj:1e9,plane:null};
LAND.g.visible=false;scene.add(LAND.g);

/* ---------- baking all meshes of a loaded model ---------- */
function bakeAll(M,toMS){ // toMS: model space (before yaw/centering/scale), else scene space
  const srcs=[],inv=toMS?new THREE.Matrix4().copy(M.inner.matrixWorld).invert():null;
  M.inner.traverse(o=>{if(o.isMesh&&o.geometry){srcs.push(bakeMesh(o,toMS?new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld):o.matrixWorld));}});
  return srcs;
}
function partRadius(ms,pv,ax){
  let r2=0;const v=new THREE.Vector3();
  ms.forEach(me=>{const g=me.geometry,pa=g.attributes.position,ix=g.index.array;
    for(let i=0;i<ix.length;i++){v.fromBufferAttribute(pa,ix[i]).sub(pv);v.addScaledVector(ax,-v.dot(ax));const d=v.lengthSq();if(d>r2)r2=d;}});
  return Math.sqrt(r2);
}

/* ---------- rig: moving parts built from triangle runs (see rig.js) ---------- */
function buildRig(M,rd){
  const F=M.inner.matrixWorld.clone(),k=M.k;
  const srcs=bakeAll(M,false),spec=rd.spec||{};
  const rig={root:new THREE.Group(),spins:[],hinges:[],gears:[],sweep:rd.sweep||null,F};
  const body=mkFrame(rig.root,ZERO);rig.body=body;const par=body.inner;
  const P=p=>V3(p).applyMatrix4(F),D=a=>V3(a).transformDirection(F);
  const put=(fr,parts,fn)=>{const ms=partMeshes(srcs,spec,parts,fn);ms.forEach(me=>fr.inner.add(me));return ms;};
  (rd.spins||[]).forEach(o=>{
    const pv=P(o.pivot),ax=D(o.axis),fr=mkFrame(par,pv);
    const fn=o.fade===0?null:(mat=>{const c=mat.clone();c.transparent=true;c.depthWrite=true;return c;});
    const ms=put(fr,o.parts,fn);
    if(!ms.length)return;
    const R=o.R?o.R*k:partRadius(ms,pv,ax),w0=(o.rps||4)*2*PI;
    const sp={o,fr,ax,ang:0,dir:o.dir||1,w0,R,mats:fn?ms.map(me=>me.material):[],disc:null,dmax:o.dmax==null?.16:o.dmax,
      b0:(o.b0==null?.28:o.b0)*w0,b1:(o.b1==null?.85:o.b1)*w0,ph:o.ph||0};
    if(fn&&o.disc!==false){
      const d=new THREE.Mesh(new THREE.CircleGeometry(R,48),discMat(o.disc||0xdde1e3,0));
      d.quaternion.setFromUnitVectors(ZAX,ax);d.position.copy(pv);d.visible=false;d.userData.disc=1;par.add(d);sp.disc=d;
    }
    rig.spins.push(sp);
  });
  (rd.hinges||[]).forEach(o=>{
    const pv=P(o.pivot),ax=D(o.axis),fr=mkFrame(par,pv);put(fr,o.parts);
    const vel=new THREE.Vector3().crossVectors(ax,P(o.tip).sub(pv)); // direction a tip moves for a positive angle
    rig.hinges.push({o,fr,ax,sign:vel.x<=0?1:-1}); // positive = swept back (toward the tail, -X)
  });
  (rd.gears||[]).forEach(o=>{
    const pv=P(o.pivot),fr=mkFrame(par,pv);put(fr,o.parts);
    rig.gears.push({o,fr,pv,ax:o.axis?D(o.axis):null,mode:o.mode||'squash',ang:(o.ang==null?90:o.ang)*D2R});
  });
  restMeshes(srcs).forEach(me=>par.add(me));
  return rig;
}
function poseRig(M,dt){
  const rig=M&&M.rig;if(!rig)return;
  const w=smooth(AN.k);
  rig.spins.forEach(sp=>{
    const ww=sp.w0*w;sp.ang+=ww*sp.dir*dt;
    sp.fr.g.quaternion.setFromAxisAngle(sp.ax,sp.ang+sp.ph);
    if(sp.disc){const b=smooth((ww-sp.b0)/(sp.b1-sp.b0));sp.disc.visible=b>.02;sp.disc.material.opacity=b*sp.dmax;sp.mats.forEach(m=>{m.opacity=1-.62*b;});}
  });
  const g=smooth(AN.gear);
  rig.gears.forEach(o=>{
    if(o.mode==='rot'){o.fr.g.quaternion.setFromAxisAngle(o.ax,o.ang*g);o.fr.g.visible=g<(o.o.hideAt||.995);}
    else if(o.mode==='hide'){o.fr.g.visible=g<.5;}
    else{o.fr.g.scale.y=lerp(1,.08,g);o.fr.g.visible=g<.97;}
  });
  if(rig.sweep)rig.hinges.forEach(h=>{h.fr.g.quaternion.setFromAxisAngle(h.ax,(AN.sw-rig.sweep.native)*D2R*h.sign*(h.o.k==null?1:h.o.k));});
}
function stepAnim(dt){
  const spinOn=AN.on||FL.on;
  if(AN.hold!=null)AN.k=AN.hold;else AN.k=clamp(AN.k+(spinOn?1:-1)*dt/(spinOn?3.2:4.5),0,1); // hold: test hook that freezes the spin factor
  AN.gear=clamp(AN.gear+(AN.gearUp?1:-1)*dt/2.6,0,1);
  AN.sw+= (AN.swT-AN.sw)*(1-Math.exp(-3*dt));
  poseRig(cur,dt);
}

/* ---------- model loading ---------- */
// Українські розпізнавальні знаки поверх текстури фюзеляжу: малюються на копії зображення, файл моделі не змінюється.
function markUA(root){
  const done=new Set();
  root.traverse(o=>{if(!o.isMesh)return;(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
    const src=m.map,im=src&&src.image;if(!im||done.has(src)||!(im.width===2048&&im.height===2048))return;done.add(src);
    const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');if(!x)return;
    try{x.drawImage(im,0,0);}catch(e){return;}
    MARK_SPOTS.forEach(([cx,cy,r])=>drawRoundel(x,cx,cy,r));
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=src.colorSpace;tex.flipY=src.flipY;tex.wrapS=src.wrapS;tex.wrapT=src.wrapT;tex.anisotropy=src.anisotropy;tex.needsUpdate=true;
    m.map=tex;m.needsUpdate=true;});});
}

async function getModel(t){
  if(cache[t.id])return cache[t.id];
  const data=await fetchModel(t);
  const g=await new Promise((res,rej)=>loader.parse(data,'',res,rej));
  const root=new THREE.Group(),inner=g.scene;
  if(t.mark==='ua')markUA(inner);
  inner.rotation.y=t.yaw*D2R;root.add(inner);
  inner.traverse(o=>{if(!o.isMesh)return;
    const ms=Array.isArray(o.material)?o.material:[o.material];
    const keep=t.keepT&&(t.keepT.test(o.name)||t.keepT.test(o.parent?.name||''));
    ms.forEach(m=>{
      m.fog=false;
      if(keep){m.transparent=true;m.depthWrite=false;m.side=THREE.DoubleSide;return;}
      if(m.transparent&&!t.glass.test(m.name||'')){m.transparent=false;m.alphaTest=t.opaque?0:.5;m.depthWrite=true;}
      if(t.glass.test(m.name||'')&&m.name){m.transparent=true;m.depthWrite=false;m.opacity=Math.min(m.opacity,.55);}
      m.side=THREE.DoubleSide;m.needsUpdate=true;});
  });
  root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root),sz=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
  const k=SIZE/Math.max(sz.x,sz.z,sz.y);
  inner.position.set(-c.x,-box.min.y,-c.z);
  const s=new THREE.Group();s.add(root);s.scale.setScalar(k);
  s.updateMatrixWorld(true);
  const M={t,obj:s,box:new THREE.Box3().setFromObject(s),meshes:[],inner,k,rig:null};
  const rd=RIG[t.model||t.id];
  if(rd){
    try{M.rig=buildRig(M,rd);M.obj=M.rig.root;}
    catch(e){console.warn('rig '+t.id,e);window.__rigErr=(window.__rigErr||'')+t.id+': '+(e&&e.message||e)+'\n';M.rig=null;M.obj=s;}
  }
  M.obj.updateMatrixWorld(true);
  M.obj.traverse(o=>{if(o.isMesh&&!o.userData.disc)M.meshes.push(o);});
  if(M.rig&&!window.__keep){M.inner=null;}
  return cache[t.id]=M;
}

/* ---------- markers: weak points snapped to the skin, stored in the model's own frame ---------- */
const ray=new THREE.Raycaster();
function placeMarker(ms,box,p){
  const x=box.min.x+(box.max.x-box.min.x)*p[0],y=box.min.y+(box.max.y-box.min.y)*p[1];
  let h;
  if(p.length===3){ // [fx, -, fz]: drop a ray from above onto wings and other thin horizontal parts
    const z=box.min.z+(box.max.z-box.min.z)*p[2];
    ray.set(new THREE.Vector3(x,box.max.y+1,z),new THREE.Vector3(0,-1,0));ray.far=box.max.y-box.min.y+2;
    h=ray.intersectObjects(ms,false)[0];
    if(!h)return {pos:new THREE.Vector3(x,box.max.y*.6,z),n:new THREE.Vector3(0,1,0)};
  }else{ // from the viewer's side (+Z) toward the centre; take the first hit on the skin
    ray.set(new THREE.Vector3(x,y,box.max.z+1),new THREE.Vector3(0,0,-1));ray.far=box.max.z-box.min.z+2;
    h=ray.intersectObjects(ms,false)[0];
    if(!h)return {pos:new THREE.Vector3(x,y,0),n:new THREE.Vector3(0,0,1)};
  }
  const n=h.face?h.face.normal.clone().transformDirection(h.object.matrixWorld):new THREE.Vector3(0,1,0);
  if(n.dot(ray.ray.direction)>0)n.negate();
  return {pos:h.point.clone(),n};
}
function buildMarkers(t,M){
  const wrap=$('#marks');wrap.innerHTML='';markers=[];selW=-1;
  M.obj.updateMatrixWorld(true);
  const inv=new THREE.Matrix4().copy(M.obj.matrixWorld).invert();
  t.weak.forEach((w,i)=>{const el=document.createElement('button');el.className='mk';el.textContent=i+1;el.title=w.t;el.setAttribute('aria-label',`Уразливе місце ${i+1}: ${w.t}`);
    el.onclick=()=>{pickWeak(i,'force');const b=document.getElementById('wk-'+i);if(b)b.scrollIntoView({behavior:'smooth',block:'nearest'});};
    wrap.appendChild(el);
    const r=placeMarker(M.meshes,M.box,w.p);
    markers.push({el,pos:r.pos.clone(),loc:r.pos.clone().applyMatrix4(inv),nl:r.n.clone().transformDirection(inv)});});
  wrap.hidden=!marksOn||FL.on;
}
const _mv=new THREE.Vector3(),_mn=new THREE.Vector3(),_md=new THREE.Vector3();
function updateMarks(){
  if(!markers.length||!cur||!marksOn||FL.on)return;
  const W=stage.clientWidth,H=stage.clientHeight,mw=cur.obj.matrixWorld;
  markers.forEach(m=>{
    m.pos.copy(m.loc).applyMatrix4(mw);
    _mv.copy(m.pos).project(cam);
    m.el.style.transform=`translate(${(_mv.x*.5+.5)*W}px,${(-_mv.y*.5+.5)*H}px)`+(m.el.classList.contains('on')?' scale(1.18)':'');
    _mn.copy(m.nl).transformDirection(mw);_md.copy(cam.position).sub(m.pos).normalize();
    m.el.classList.toggle('hid',_mn.dot(_md)<.04||_mv.z>1);
  });
}

/* ---------- views ---------- */
const VIEWS={iso:[1,.55,1.25],side:[0,.18,1],top:[0,1,.0001],front:[1,.15,0]};
function setView(v,instant){
  if(FL.on||reveal.on)return;
  view=v;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===v));
  const d=VIEWS[v],dist=SIZE*(cur&&cur.rig&&cur.rig.spins&&cur.rig.spins.length?1.68:1.55)/Math.min(1,cam.aspect*.95),tgt=new THREE.Vector3(0,cur?cur.box.max.y*.42:1.2,0);
  const to=new THREE.Vector3(...d).normalize().multiplyScalar(dist).add(tgt);
  if(instant){cam.position.copy(to);ctl.target.copy(tgt);ctl.update();return;}
  anim={from:cam.position.clone(),to,ft:ctl.target.clone(),tt:tgt,t:0};
  if(v!=='iso')setSpin(false);
}

/* ---------- UI ---------- */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function renderIdx(){
  const idx=$('#idx');idx.innerHTML='';
  T.filter(t=>t.cat===cat).forEach(t=>{
    const b=document.createElement('button');b.className='it'+(t.cat==='other'?' other':'');b.id='it-'+t.id;
    b.setAttribute('aria-current',t.id===curId);
    b.innerHTML=`<span class="n">${esc(t.name)}</span>${t.dual?'<span class="tag" title="Є і в ЗСУ">ОБИДВІ</span>':''}<span class="c">${esc(t.nato!=='—'?t.nato+' · ':'')}${esc(t.cls)}</span>`;
    b.onclick=()=>select(t.id);idx.appendChild(b);
  });
  const on=document.getElementById('it-'+curId);if(on&&innerWidth<=720)idx.scrollLeft=Math.max(0,on.offsetLeft-idx.offsetLeft-16);
  $('#cnt-enemy').textContent=T.filter(t=>t.cat==='enemy').length;
  $('#cnt-other').textContent=T.filter(t=>t.cat==='other').length;
}
function renderSheet(t){
  const sh=$('#sheet');sh.className='sheet'+(t.cat==='other'?' other':'');
  const rows=t.specs.map(([a,b])=>`<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('');
  const li=a=>a.map(x=>`<li><span>${esc(x)}</span></li>`).join('');
  sh.innerHTML=`
   <div class="hd"><span class="cls">${esc(t.cls)}</span><h2>${esc(t.name)}</h2>${t.nato!=='—'?`<span class="nato">Кодове ім'я НАТО: ${esc(t.nato)}</span>`:''}<p class="st">${esc(t.st)}</p></div>
   ${t.dual?`<div class="flag"><i>УВАГА</i><span>${esc(t.dual)}</span></div>`:''}
   ${t.weak.length?`<section><h3>${esc(t.weakTitle||'Уразливі місця')}</h3><div class="weak">${t.weak.map((w,i)=>`<button class="wk" id="wk-${i}" data-i="${i}"><b>${i+1}</b><strong>${esc(w.t)}</strong><span>${esc(w.d)}</span></button>`).join('')}</div></section>`:''}
   ${t.note?`<p class="note">${esc(t.note)}</p>`:''}
   <section><h3>Ознаки розпізнавання</h3><ul class="l">${li(t.rec)}</ul></section>
   <section><h3>Характеристики</h3><table>${rows}</table></section>
   <section><h3>Озброєння</h3><ul class="l">${li(t.arm)}</ul></section>`;
  sh.querySelectorAll('.wk').forEach(b=>b.onclick=()=>pickWeak(+b.dataset.i,true));
  $('#credit').innerHTML=creditHtml('aviation/'+(t.model||t.id));
  $('#ovT').textContent=t.nato!=='—'?t.nato:t.cls.split(' · ')[0];
}
function pickWeak(i,fromList){
  selW=selW===i&&fromList!=='force'?-1:i;
  document.querySelectorAll('.wk').forEach(b=>b.classList.toggle('on',+b.dataset.i===selW));
  markers.forEach((m,j)=>m.el.classList.toggle('on',j===selW));
  if(selW>=0&&!FL.on){setSpin(false);const p=markers[selW].pos;const dir=cam.position.clone().sub(ctl.target);
    // swing the camera to the marker's side
    const side=new THREE.Vector3(p.x*.4,0,p.z>=0?1:-1).normalize();const d=dir.length();
    const tgt=new THREE.Vector3(p.x*.5,p.y,p.z*.3);
    anim={from:cam.position.clone(),to:tgt.clone().add(new THREE.Vector3(side.x,.35,side.z).normalize().multiplyScalar(d)),ft:ctl.target.clone(),tt:tgt,t:0};
    if(fromList===true&&innerWidth<=720)stage.scrollIntoView({behavior:'smooth',block:'center'});
  }
}

/* extra controls: gear, sweep, flight camera */
function syncX(){
  const M=cur,r=M&&M.rig,t=M&&M.t;
  const hasG=!!(r&&r.gears.length),hasS=!!(r&&r.sweep),canFly=!!(t&&FLYD[t.model||t.id]);
  $('#t-gear').hidden=!hasG;$('#sw-wrap').hidden=!hasS;$('#t-fly').hidden=!canFly;$('#t-cam').hidden=!FL.on;
  $('#t-reveal').hidden=!(t&&t.reveal);$('#t-reveal').setAttribute('aria-pressed',reveal.on);
  $('#xctl').hidden=!(hasG||hasS||FL.on);
  $('#t-gear').textContent=AN.gearUp?'Шасі: прибрано':'Шасі: випущено';$('#t-gear').setAttribute('aria-pressed',AN.gearUp);
  if(hasS){const s=r.sweep,inp=$('#sw');inp.min=s.min;inp.max=s.max;inp.value=AN.swT;$('#sw-o').textContent=Math.round(AN.swT)+'°';}
  $('#t-fly').setAttribute('aria-pressed',FL.on);
  $('#t-cam').textContent=FL.cam==='follow'?'Камера: слідкує':'Камера: спостерігач';
  const an=(t&&RIG[t.model||t.id]&&RIG[t.model||t.id].anim)||null;
  $('#anote').textContent=an&&r?'Рухається: '+an.join(', ')+'.':(t&&FLYD[t.model||t.id]?'':'Статична модель без рухомих частин.');
}
let token=0;
async function select(id){
  const t=T.find(x=>x.id===id);if(!t)return;curId=id;
  if(reveal.on)reveal.stop();
  renderIdx();renderSheet(t);
  const my=++token;$('#load').hidden=false;$('#load').textContent='Завантаження моделі…';$('#marks').innerHTML='';markers=[];
  try{
    const M=await getModel(t);if(my!==token)return;
    if(cur&&cur!==M)cur.obj.position.set(0,0,0);
    holder.clear();holder.add(M.obj);cur=M;
    M.obj.updateMatrixWorld(true);
    $('#ovR').textContent=t.specs.find(s=>/Довжина/.test(s[0]))?.[1]||'';
    AN.gear=0;AN.gearUp=false;
    if(M.rig&&M.rig.sweep){AN.sw=AN.swT=M.rig.sweep.def;}
    buildMarkers(t,M);
    if(FL.on){if(FLYD[t.model||t.id])prepFlight();else endFlight();}
    if(!FL.on)setView(view==='iso'?'iso':view,true);
    syncX();
    $('#load').hidden=true;
  }catch(e){if(my===token)$('#load').textContent='Не вдалося завантажити модель';window.__err=String(e&&e.stack||e);console.error(e);}
  try{history.replaceState(null,'','#'+id);}catch(e){}
}
function setCat(c){cat=c;document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-selected',b.dataset.cat===c));
  const first=T.find(t=>t.cat===c);select(first.id);}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setCat(b.dataset.cat));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
function setSpin(on){ctl.autoRotate=on&&!FL.on;$('#t-spin').setAttribute('aria-pressed',on);}
$('#t-spin').onclick=()=>setSpin(!ctl.autoRotate);
$('#t-marks').onclick=()=>{marksOn=!marksOn;$('#t-marks').setAttribute('aria-pressed',marksOn);$('#marks').hidden=!marksOn||FL.on||reveal.on;};
$('#t-anim').onclick=()=>{if(reveal.on)return;AN.on=!AN.on;$('#t-anim').setAttribute('aria-pressed',AN.on);};
$('#t-gear').onclick=()=>{AN.gearUp=!AN.gearUp;syncX();};
$('#sw').oninput=e=>{AN.swT=+e.target.value;$('#sw-o').textContent=Math.round(AN.swT)+'°';};
$('#t-fly').onclick=()=>setFly(!FL.on);
$('#t-cam').onclick=()=>setCamMode(FL.cam==='follow'?'obs':'follow');
cv.addEventListener('pointerdown',()=>{anim=null;});
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.key==='Escape'&&reveal.on){setReveal(false);return;}if(e.key==='Escape'&&selW>=0)pickWeak(selW,true);if(FL.on&&(e.key==='c'||e.key==='C'||e.key==='с'||e.key==='С'))setCamMode(FL.cam==='follow'?'obs':'follow');});

/* ---------- презентація: ангар, чохол, запуск і зліт (reveal.js) ---------- */
const reveal=createReveal({scene,cam,ctl,holder,stage,cv,lights:[key,hemi],floor,AN,onEnd:()=>{
  stage.classList.remove('reveal');$('#ovS').hidden=true;$('#marks').hidden=!marksOn;
  $('#t-reveal').setAttribute('aria-pressed',false);if(cur)setView(view,true);syncX();
}});
function setReveal(on){
  if(on===reveal.on)return;
  if(!on){reveal.stop();return;}
  const t=cur&&cur.t;if(!t||!t.reveal||FL.busy)return;
  if(FL.on)endFlight();
  anim=null;if(selW>=0)pickWeak(selW,true);
  stage.classList.add('reveal');$('#marks').hidden=true;$('#ovS').hidden=false;
  reveal.start(cur);
  $('#t-reveal').setAttribute('aria-pressed',true);syncX();
}
$('#t-reveal').onclick=()=>setReveal(!reveal.on);

/* ---------- landscape: mirrored photogrammetry tiles, recentred around the aircraft ---------- */
const canvasTex=(w,h,fn)=>{const c=document.createElement('canvas');c.width=w;c.height=h;fn(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;};
const shadowTex=canvasTex(128,128,(x,w)=>{const g=x.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,'rgba(0,0,0,.6)');g.addColorStop(.55,'rgba(0,0,0,.32)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,w);});
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,fog:false,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6}));
shadow.rotation.x=-PI/2;shadow.renderOrder=2;shadow.visible=false;scene.add(shadow);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(60000,60000),new THREE.MeshBasicMaterial({color:0x6d7658,fog:true}));
ground.rotation.x=-PI/2;ground.visible=false;scene.add(ground);

function loadLand(){
  if(LAND.ready||LAND.failed)return Promise.resolve();
  if(LAND.loading)return LAND.loading;
  return LAND.loading=(async()=>{try{
    const landBuf=await fetchBuffer(LAND_URL);
    const g=await new Promise((res,rej)=>loader.parse(landBuf,'',res,rej));
    g.scene.updateMatrixWorld(true);let mesh=null;g.scene.traverse(o=>{if(o.isMesh)mesh=o;});if(!mesh)throw new Error('no land mesh');
    const geo=mesh.geometry.clone();
    for(const name of ['position','uv']){const at=geo.attributes[name];if(!at)continue;const n=at.itemSize,f=new Float32Array(at.count*n);for(let i=0;i<at.count;i++){f[i*n]=at.getX(i);if(n>1)f[i*n+1]=at.getY(i);if(n>2)f[i*n+2]=at.getZ(i);}geo.setAttribute(name,new THREE.BufferAttribute(f,n));}
    if(geo.attributes.normal)geo.deleteAttribute('normal');
    geo.applyMatrix4(mesh.matrixWorld);geo.scale(LAND.S,LAND.S*LAND.YS,LAND.S);
    const pa=geo.attributes.position;
    geo.computeBoundingBox();const bb=geo.boundingBox,sz=bb.getSize(new THREE.Vector3());LAND.L=sz.x;LAND.W=sz.z;LAND.bb=bb;
    const GW=LAND.GW,GH=LAND.GH,sum=new Float32Array(GW*GH),cnt=new Uint16Array(GW*GH);let hs=0;
    for(let i=0;i<pa.count;i++){const gx=clamp(((pa.getX(i)-bb.min.x)/sz.x*GW)|0,0,GW-1),gz=clamp(((pa.getZ(i)-bb.min.z)/sz.z*GH)|0,0,GH-1);sum[gz*GW+gx]+=pa.getY(i);cnt[gz*GW+gx]++;hs+=pa.getY(i);}
    const h0=hs/pa.count; // terrain level 0 = mean height
    const H=new Float32Array(GW*GH);for(let i=0;i<H.length;i++)H[i]=cnt[i]?sum[i]/cnt[i]:NaN;
    for(let it=0;it<14;it++)for(let j=0;j<GH;j++)for(let i=0;i<GW;i++){const k=j*GW+i;if(!isNaN(H[k]))continue;let a=0,n=0;[[1,0],[-1,0],[0,1],[0,-1]].forEach(([di,dj])=>{const x=i+di,y=j+dj;if(x<0||y<0||x>=GW||y>=GH)return;const h=H[y*GW+x];if(!isNaN(h)){a+=h;n++;}});if(n)H[k]=a/n;}
    for(let i=0;i<H.length;i++)if(isNaN(H[i]))H[i]=h0;
    LAND.H=H;LAND.y0=-h0;
    const mat=mesh.material;mat.side=THREE.FrontSide;mat.fog=true;if(mat.map){mat.map.colorSpace=THREE.SRGBColorSpace;mat.map.anisotropy=Math.min(8,R.capabilities.getMaxAnisotropy());}
    // average ground colour for the flat plane that continues the terrain to the horizon
    try{const im=mat.map&&mat.map.image;if(im){const c=document.createElement('canvas');c.width=c.height=4;const x=c.getContext('2d');x.drawImage(im,0,0,4,4);const d=x.getImageData(0,0,4,4).data;let r=0,gg=0,b=0;for(let i=0;i<64;i+=4){r+=d[i];gg+=d[i+1];b+=d[i+2];}ground.material.color.setRGB(r/16/255,gg/16/255,b/16/255,THREE.SRGBColorSpace);}}catch(e){}
    for(let n=0;n<9;n++){const t=new THREE.Mesh(geo,mat);t.frustumCulled=false;LAND.g.add(t);LAND.tiles.push(t);}
    LAND.ready=true;
  }catch(e){console.warn('land',e);LAND.failed=true;window.__landErr=String(e&&e.stack||e);}})();
}
function placeTiles(ci,cj){
  const bb=LAND.bb,L=LAND.L,W=LAND.W;let n=0;
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const i=ci+a,j=cj+b,t=LAND.tiles[n++];
    t.scale.set(i&1?-1:1,1,j&1?-1:1);
    t.position.set(i*L+(i&1?bb.min.x+bb.max.x:0),LAND.y0,j*W+(j&1?bb.min.z+bb.max.z:0));}
  LAND.ci=ci;LAND.cj=cj;
}
function hAt(x,z){if(!LAND.ready)return 0;const bb=LAND.bb,L=LAND.L,W=LAND.W;
  const nx=Math.floor((x-bb.min.x)/L),nz=Math.floor((z-bb.min.z)/W);let lx=x-nx*L,lz=z-nz*W;
  if(nx&1)lx=bb.min.x+bb.max.x-lx;if(nz&1)lz=bb.min.z+bb.max.z-lz;
  const GW=LAND.GW,GH=LAND.GH,fx=clamp((lx-bb.min.x)/L*(GW-1),0,GW-1.001),fz=clamp((lz-bb.min.z)/W*(GH-1),0,GH-1.001);
  const i=fx|0,j=fz|0,a=fx-i,b=fz-j,H=LAND.H;
  return H[j*GW+i]*(1-a)*(1-b)+H[j*GW+i+1]*a*(1-b)+H[(j+1)*GW+i]*(1-a)*b+H[(j+1)*GW+i+1]*a*b+LAND.y0;}

/* ---------- flight: coordinated right-hand circle at a fixed altitude ---------- */
const obsPos=new THREE.Vector3(),_w=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0);
function flightScale(M,t){
  const f=FLYD[t.model||t.id],b=M.box,ext={x:b.max.x-b.min.x,y:b.max.y-b.min.y,z:b.max.z-b.min.z};
  let u=ext[f.ref]||ext.x;
  if(f.ref==='rotor'&&M.rig&&M.rig.spins.length)u=2*Math.max(...M.rig.spins.map(s=>s.R));
  return f.real/u;
}
function aircraftPose(){
  const f=FL;
  f.x=f.cx-f.R*Math.sin(f.psi);f.z=f.cz-f.R*Math.cos(f.psi);f.y=f.alt;
  holder.position.set(f.x,f.y,f.z);holder.rotation.set(f.ph,f.psi,f.th);
}
function prepFlight(){
  const M=cur,t=M&&M.t,f=t&&FLYD[t.model||t.id];if(!f){endFlight();return;}
  FL.sc=flightScale(M,t);FL.D=SIZE*FL.sc;
  FL.v=f.v;FL.alt=f.alt;FL.pitch=(f.pitch||0)*D2R;FL.bank=Math.min(62*D2R,f.bank?f.bank*D2R:Math.atan(f.v*f.v/(G*(f.R||400))));
  FL.R=f.R||f.v*f.v/(G*Math.tan(FL.bank));
  FL.cx=0;FL.cz=0;FL.psi=0;FL.ph=0;FL.th=FL.pitch;FL.t=0;
  const cy=(M.box.min.y+M.box.max.y)/2;M.obj.position.set(0,-cy,0);
  holder.scale.setScalar(FL.sc);holder.rotation.order='YZX';
  floor.visible=false;
  const reach=LAND.ready?Math.min(LAND.L,LAND.W):900,far=Math.max(reach*1.15,FL.alt*2.6,700);
  scene.background=new THREE.Color(SKY);scene.fog=new THREE.Fog(SKY,far*.38,far);
  LAND.g.visible=LAND.ready;ground.visible=true;ground.position.y=LAND.ready?LAND.y0+(LAND.bb?LAND.bb.min.y:0)-1:-2;
  shadow.visible=true;
  ctl.autoRotate=false;
  ctl.minDistance=FL.D*.7;ctl.maxDistance=FL.D*16;ctl.maxPolarAngle=PI*.495;
  cam.near=Math.max(.3,FL.D*.012);cam.far=Math.max(9000,FL.R*3);cam.fov=32;cam.updateProjectionMatrix();
  if(M.rig&&M.rig.gears.length)AN.gearUp=true;
  if(M.rig&&M.rig.sweep&&M.rig.sweep.fly!=null){AN.swT=M.rig.sweep.fly;}
  $('#marks').hidden=true;
  aircraftPose();
  if(LAND.ready)placeTiles(Math.floor((FL.x-LAND.bb.min.x)/LAND.L),Math.floor((FL.z-LAND.bb.min.z)/LAND.W));
  setCamMode(FL.cam,true);
  $('#ovS').hidden=false;
  syncX();
}
function endFlight(){
  if(!FL.on)return;
  FL.on=false;
  holder.scale.setScalar(1);holder.position.set(0,0,0);holder.rotation.set(0,0,0);
  if(cur){cur.obj.position.set(0,0,0);if(cur.rig){AN.gearUp=false;if(cur.rig.sweep)AN.swT=cur.rig.sweep.def;}}
  floor.visible=true;scene.background=null;scene.fog=null;LAND.g.visible=false;ground.visible=false;shadow.visible=false;
  ctl.enabled=true;ctl.minDistance=3;ctl.maxDistance=40;ctl.maxPolarAngle=PI;
  cam.near=.05;cam.far=500;cam.fov=32;cam.updateProjectionMatrix();
  $('#ovS').hidden=true;$('#marks').hidden=!marksOn;
  if(wasSpin)setSpin(true);
  setView(view,true);syncX();
}
async function setFly(on){
  if(on===FL.on||FL.busy)return;
  if(!on){endFlight();syncX();return;}
  const t=cur&&cur.t;if(!t||!FLYD[t.model||t.id])return;
  if(reveal.on)reveal.stop();
  FL.busy=true;
  try{
    if(!LAND.ready&&!LAND.failed){$('#load').hidden=false;$('#load').textContent='Завантаження ландшафту…';await loadLand();$('#load').hidden=true;}
    wasSpin=ctl.autoRotate;
    FL.on=true;prepFlight();
  }finally{FL.busy=false;}
  syncX();
}
function placeFollow(){
  const d=FL.D*2.4,off=new THREE.Vector3(-d*.78,d*.32,d*.62).applyAxisAngle(UP,FL.psi);
  ctl.target.set(FL.x,FL.y,FL.z);cam.position.set(FL.x,FL.y,FL.z).add(off);cam.fov=32;cam.updateProjectionMatrix();ctl.update();
}
function setCamMode(m,force){
  if(m===FL.cam&&!force){return;}
  FL.cam=m;
  if(m==='obs'){ctl.enabled=false;obsPos.set(FL.cx,hAt(FL.cx,FL.cz)+3,FL.cz);cam.position.copy(obsPos);}
  else{ctl.enabled=true;placeFollow();}
  syncX();
}
function flightStep(dt){
  const f=FL;f.t+=dt;
  f.psi-=f.v/f.R*dt;
  const bt=Math.atan(f.v*f.v/(G*f.R)),k=1-Math.exp(-1.6*dt);
  f.ph+=(Math.min(bt,62*D2R)-f.ph)*k;
  aircraftPose();
  if(LAND.ready){const ci=Math.floor((f.x-LAND.bb.min.x)/LAND.L),cj=Math.floor((f.z-LAND.bb.min.z)/LAND.W);if(ci!==LAND.ci||cj!==LAND.cj)placeTiles(ci,cj);}
  const gy=hAt(f.x,f.z),alt=f.y-gy;
  shadow.position.set(f.x,gy+.25,f.z);const ss=f.D*1.2*(1+alt*.0012);shadow.scale.set(ss,ss,1);shadow.material.opacity=clamp(1-alt/(f.D*22),.12,1);
  ground.position.x=f.x;ground.position.z=f.z;
  const bank=Math.round(f.ph/D2R);
  const txt=`Політ по колу · ${Math.round(f.v*3.6)} км/год · висота ${Math.round(alt)} м · крен ${bank}°`;
  if($('#ovS').textContent!==txt)$('#ovS').textContent=txt;
}
function camFlight(dt){
  const f=FL;
  if(f.cam==='follow'){
    _w.set(f.x,f.y,f.z);
    const k=1-Math.exp(-(9+f.v*.7)*dt);
    const dx=(_w.x-ctl.target.x)*k,dy=(_w.y-ctl.target.y)*k,dz=(_w.z-ctl.target.z)*k;
    ctl.target.x+=dx;ctl.target.y+=dy;ctl.target.z+=dz;cam.position.x+=dx;cam.position.y+=dy;cam.position.z+=dz;ctl.update();
  }else{
    _w.set(f.x,f.y,f.z);cam.position.copy(obsPos);cam.lookAt(_w);
    const dist=cam.position.distanceTo(_w);cam.fov=clamp(2*Math.atan(f.D*.85/dist)*180/PI,1.2,34);cam.updateProjectionMatrix();
  }
  const gy=hAt(cam.position.x,cam.position.z)+1.5;if(cam.position.y<gy)cam.position.y=gy;
}

/* ---------- loop ---------- */
function resize(){const w=stage.clientWidth,h=stage.clientHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);resize();
const clock=makeClock();
function frame(dt,nr){
  frameN++;
  if(anim&&!FL.on&&!reveal.on){anim.t=Math.min(1,anim.t+.045);const e=1-Math.pow(1-anim.t,3);cam.position.lerpVectors(anim.from,anim.to,e);ctl.target.lerpVectors(anim.ft,anim.tt,e);if(anim.t>=1)anim=null;}
  if(cur)stepAnim(dt);
  if(reveal.on)reveal.step(dt);
  if(FL.on&&cur){flightStep(dt);camFlight(dt);}else ctl.update();
  if(!nr){R.render(scene,cam);updateMarks();}
}
function loop(){if(!window.__paused)requestAnimationFrame(loop);frame(Math.min(.05,clock.getDelta()));}

/* ---------- boot ---------- */
const start=(location.hash||'').slice(1);const t0=T.find(t=>t.id===start)||T[0];
cat=t0.cat;document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-selected',b.dataset.cat===cat));select(t0.id);
loop();
window.__T=T;window.__select=select;window.__setView=setView;window.__ready=()=>!!cur&&$('#load').hidden&&!FL.busy;
window.__tick=(n,dt)=>{for(let i=0;i<n;i++)frame(dt||1/30,i<n-1);};
window.__snap=()=>{frame(0);return cv.toDataURL('image/png');};
window.__AN=AN;window.__FL=FL;window.__reveal=reveal;window.__setReveal=setReveal;window.__LAND=LAND;window.__cur=()=>cur;window.__setFly=setFly;window.__setCam=setCamMode;window.__hAt=hAt;window.__markers=()=>markers;
window.__camSet=(p,t,fov)=>{ctl.minDistance=.05;cam.position.set(p[0],p[1],p[2]);ctl.target.set(t[0],t[1],t[2]);if(fov){cam.fov=fov;cam.updateProjectionMatrix();}ctl.autoRotate=false;ctl.update();}; // для перевірок: камера з коду
window.__snapM=function(){
  frame(0);const W=cv.width,H=cv.height,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(cv,0,0);
  const sx=W/stage.clientWidth,v=new THREE.Vector3();
  markers.forEach((m,i)=>{v.copy(m.pos).project(cam);const px=(v.x*.5+.5)*W,py=(-v.y*.5+.5)*H;x.beginPath();x.arc(px,py,11*sx,0,7);x.fillStyle=m.el.classList.contains('hid')?'rgba(226,104,63,.35)':'rgba(226,104,63,.95)';x.fill();x.fillStyle='#000';x.font=Math.round(12*sx)+'px sans-serif';x.textAlign='center';x.fillText(i+1,px,py+4*sx);});
  return c.toDataURL('image/png');
};
