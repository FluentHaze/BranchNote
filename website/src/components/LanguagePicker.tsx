import Select, { type SelectOption } from "./Select";

interface Props {
  value: string;
  options: SelectOption[];
}

export default function LanguagePicker({ value, options }: Props) {
  return (
    <Select
      className="language"
      label="Language / 语言"
      value={value}
      options={options}
      onChange={path => window.location.assign(path + window.location.hash)}
    />
  );
}
