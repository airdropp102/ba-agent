// Explicitly approved for BA Studio Figma subprocesses; never applied to BA analysis.
export const FIGMA_APPROVED_TOOLS=Object.freeze(['join_channel','get_document_info','get_selection','get_node_info','get_nodes_info','get_styles','get_local_components','create_section','create_frame','create_rectangle','create_text','create_component_instance','set_fill_color','set_stroke_color','set_text_content','set_multiple_text_contents','set_corner_radius','set_layout_mode','set_padding','set_axis_align','set_layout_sizing','set_item_spacing','move_node','resize_node','rename_node','set_parent','export_node_as_image']);
const phases={preflight:['join_channel','get_document_info','get_selection'],design:FIGMA_APPROVED_TOOLS,preview:['join_channel','get_document_info','get_node_info','export_node_as_image']};
export function figmaToolConfigArgs(phase){
 if(phase===undefined)return [];
 if(!Object.hasOwn(phases,phase))throw new Error('Invalid Figma tool phase');
 const tools=phases[phase];
 return ['-c',`mcp_servers.TalkToFigma.enabled_tools=${JSON.stringify(tools)}`,...tools.flatMap(tool=>['-c',`mcp_servers.TalkToFigma.tools.${tool}.approval_mode="approve"`])];
}
