import { Modal, RadioButton, RadioButtonGroup } from "@carbon/react";
import {
  DIAGRAM_TEMPLATES,
  REFERENCE_ARCHITECTURE_TEMPLATES,
  type DiagramTemplateId,
} from "@icad/core";
import { useState } from "react";

export interface NewDiagramDialogProps {
  open: boolean;
  hasExistingContent: boolean;
  onClose: () => void;
  onCreate: (templateId: DiagramTemplateId) => void;
}

export function NewDiagramDialog({
  open,
  hasExistingContent,
  onClose,
  onCreate,
}: NewDiagramDialogProps) {
  const [selection, setSelection] = useState<DiagramTemplateId>("high-level");

  return (
    <Modal
      open={open}
      size="sm"
      modalLabel="New diagram"
      modalHeading="Choose an IBM diagram level"
      primaryButtonText="Create diagram"
      secondaryButtonText="Cancel"
      onRequestClose={onClose}
      onRequestSubmit={() => onCreate(selection)}
    >
      {hasExistingContent ? (
        <p className="icad-new-diagram__warning">
          Creating this diagram replaces the current document. Save it first if
          you want to keep it.
        </p>
      ) : (
        <p className="icad-new-diagram__intro">
          Start with conventions and structure suited to the level of detail you
          need.
        </p>
      )}
      <RadioButtonGroup
        name="icad-diagram-template"
        legendText="Diagram level"
        orientation="vertical"
        valueSelected={selection}
        onChange={(value) => setSelection(value as DiagramTemplateId)}
      >
        {DIAGRAM_TEMPLATES.map((template) => (
          <RadioButton
            key={template.id}
            id={`icad-template-${template.id}`}
            value={template.id}
            labelText={
              <span className="icad-new-diagram__option">
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </span>
            }
          />
        ))}
      </RadioButtonGroup>
      <RadioButtonGroup
        name="icad-reference-architecture-template"
        legendText="Reference architectures"
        orientation="vertical"
        valueSelected={selection}
        onChange={(value) => setSelection(value as DiagramTemplateId)}
      >
        {REFERENCE_ARCHITECTURE_TEMPLATES.map((template) => (
          <RadioButton
            key={template.id}
            id={`icad-template-${template.id}`}
            value={template.id}
            labelText={
              <span className="icad-new-diagram__option">
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </span>
            }
          />
        ))}
      </RadioButtonGroup>
    </Modal>
  );
}
