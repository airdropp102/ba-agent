export const sampleTitle = 'Cổng tiếp nhận và xử lý bảo hành';
export const sampleBrief = `Khách hàng muốn triển khai cổng bảo hành máy lọc nước. Khách hàng có thể đăng ký bảo hành bằng số seri và số điện thoại. Nhân viên trạm bảo hành xem danh sách yêu cầu, cập nhật trạng thái 'Tiếp nhận', 'Đang xử lý', 'Hoàn thành'. Quản trị viên xem báo cáo số phiếu theo trạng thái. Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên.`;

export function demoAnalysis(title, brief) {
  const sample = brief.includes('máy lọc nước') && brief.includes('số seri');
  if (!sample) return {
    projectName:title, executiveSummary:brief.slice(0,320),
    businessProblem:'Chưa xác định — cần phỏng vấn khách hàng',businessGoals:[],
    stakeholders:[],scopeIn:[],scopeOut:[],businessRules:[],functionalRequirements:[],
    nonFunctionalRequirements:[],clarificationQuestions:[
      {question:'Ai là người dùng và mục tiêu kinh doanh chính?',impact:'Chưa thể xác định actor và phạm vi',priority:'High'},
      {question:'Các chức năng bắt buộc, quy tắc nghiệp vụ và ngoại lệ cụ thể là gì?',impact:'Không đủ dữ liệu để viết SRS',priority:'High'},
      {question:'Tiêu chí nghiệm thu và mức đo NFR được xác nhận là gì?',impact:'Chưa thể kiểm thử/nhận bàn giao',priority:'High'}
    ],assumptions:[],risks:['Brief ngắn hoặc chưa có cấu trúc; bản demo không thay thế phân tích AI.']
  };
  return {
    projectName:title,
    executiveSummary:'Xây dựng cổng đăng ký, xử lý và thống kê yêu cầu bảo hành máy lọc nước.',
    businessProblem:'Chưa được nêu rõ trong brief — cần xác nhận pain point và KPI.',
    businessGoals:['Tiếp nhận yêu cầu bảo hành','Quản lý quá trình xử lý bảo hành','Theo dõi số phiếu theo trạng thái'],
    stakeholders:[{role:'Khách hàng',need:'Đăng ký bảo hành'},{role:'Nhân viên trạm',need:'Xử lý yêu cầu'},{role:'Quản trị viên',need:'Xem thống kê'}],
    scopeIn:['Đăng ký bảo hành','Theo dõi và cập nhật trạng thái yêu cầu','Báo cáo số phiếu theo trạng thái','Phân quyền theo vai trò'],
    scopeOut:[],businessRules:[{
      rule:'Phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên.',
      sourceEvidence:'Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên.',certainty:'confirmed'
    }],
    functionalRequirements:[
      {name:'Đăng ký bảo hành',description:'Khách hàng nhập số seri và số điện thoại để đăng ký bảo hành.',actor:'Khách hàng',priority:'Must',sourceEvidence:'Khách hàng có thể đăng ký bảo hành bằng số seri và số điện thoại.',certainty:'confirmed',relatedBusinessGoal:'Tiếp nhận yêu cầu bảo hành',preconditions:[],mainFlow:['Mở form đăng ký','Nhập số seri và số điện thoại','Gửi yêu cầu (cần xác nhận quy tắc kiểm tra và phản hồi)'],alternateFlows:[],acceptanceCriteria:['Cho phép nhập số seri và số điện thoại','Cần xác nhận kết quả xử lý khi gửi form']},
      {name:'Xử lý yêu cầu',description:'Nhân viên trạm xem danh sách và cập nhật trạng thái.',actor:'Nhân viên trạm',priority:'Must',sourceEvidence:"Nhân viên trạm bảo hành xem danh sách yêu cầu, cập nhật trạng thái 'Tiếp nhận', 'Đang xử lý', 'Hoàn thành'.",certainty:'confirmed',relatedBusinessGoal:'Quản lý quá trình xử lý bảo hành',preconditions:[],mainFlow:['Mở danh sách yêu cầu','Chọn một yêu cầu','Cập nhật trạng thái'],alternateFlows:[],acceptanceCriteria:['Danh sách hiển thị yêu cầu','Hỗ trợ ba trạng thái đã nêu']},
      {name:'Thống kê trạng thái',description:'Quản trị viên xem báo cáo số phiếu theo trạng thái.',actor:'Quản trị viên',priority:'Must',sourceEvidence:'Quản trị viên xem báo cáo số phiếu theo trạng thái.',certainty:'confirmed',relatedBusinessGoal:'Theo dõi số phiếu theo trạng thái',preconditions:[],mainFlow:['Mở trang báo cáo','Xem số phiếu theo từng trạng thái'],alternateFlows:[],acceptanceCriteria:['Báo cáo nhóm phiếu theo trạng thái']}
    ],
    nonFunctionalRequirements:[],
    clarificationQuestions:[
      {question:'Xác thực người dùng và kiểm tra phân quyền bằng cơ chế nào?',impact:'Ảnh hưởng bảo mật và luồng đăng nhập',priority:'High'},
      {question:'Số seri trùng lặp, không hợp lệ hoặc hết hạn bảo hành thì xử lý thế nào?',impact:'Ảnh hưởng business rules và validation',priority:'High'},
      {question:'Các trạng thái có được quay lui và ai được chuyển trạng thái?',impact:'Ảnh hưởng transition/permission',priority:'High'},
      {question:'Báo cáo cần bộ lọc thời gian, trạm và xuất file không?',impact:'Ảnh hưởng phạm vi báo cáo',priority:'Medium'}
    ],assumptions:['Luồng gửi biểu mẫu, kiểm tra dữ liệu và thông báo kết quả chưa được khách hàng mô tả.'],
    risks:['Chưa có quy tắc trạng thái, kiểm tra số seri và cơ chế xác thực.']
  };
}

export function demoPrototype(analysis) {
  if (analysis.functionalRequirements.length === 0) return {screens:[{
    id:'SCREEN1',title:'Cần làm rõ',description:'Chưa đủ yêu cầu được xác nhận để dựng luồng nghiệp vụ.',requirementIds:[],
    components:[{type:'heading',label:'Cần làm rõ yêu cầu',placeholder:'',value:'',options:[],actionTarget:''},{type:'paragraph',label:'Hãy trả lời câu hỏi và phân tích lại với AI trước khi làm prototype.',placeholder:'',value:'',options:[],actionTarget:''}]
  }]};
  const el=(type,label,placeholder='',value='',actionTarget='',options=[])=>({type,label,placeholder,value,actionTarget,options});
  return {screens:[
    {id:'SCREEN1',title:'Đăng ký bảo hành',description:'Bản phác thảo — quy tắc kiểm tra dữ liệu chờ xác nhận.',requirementIds:['FR-001'],components:[
      el('heading','Đăng ký bảo hành'),el('input','Số seri','Nhập số seri'),el('input','Số điện thoại','Nhập số điện thoại'),
      el('button','Gửi yêu cầu (minh họa)'),el('button','Đến danh sách yêu cầu','','','SCREEN2')
    ]},
    {id:'SCREEN2',title:'Danh sách bảo hành',description:'Minh họa giao diện nhân viên trạm — chưa có dữ liệu thật.',requirementIds:['FR-002'],components:[
      el('heading','Yêu cầu bảo hành'),el('card','Phiếu demo #001 — Tiếp nhận'),
      el('select','Trạng thái (minh họa)','','','','Tiếp nhận|Đang xử lý|Hoàn thành'.split('|')),
      el('button','Đến báo cáo','','','SCREEN3'),el('button','Về đăng ký','','','SCREEN1')
    ]},
    {id:'SCREEN3',title:'Báo cáo',description:'Chỉ hiển thị dữ liệu mẫu, chưa kết nối hệ thống.',requirementIds:['FR-003'],components:[
      el('heading','Báo cáo số phiếu theo trạng thái'),el('badge','Tiếp nhận: 3 (demo)'),el('badge','Đang xử lý: 2 (demo)'),
      el('badge','Hoàn thành: 7 (demo)'),el('button','Về danh sách','','','SCREEN2')
    ]}
  ]};
}
